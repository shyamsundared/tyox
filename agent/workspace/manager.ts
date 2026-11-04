import { CommandExitError, Sandbox, SandboxNotFoundError } from "e2b";
import { reactStarterFiles } from "./starter-files";
import { remainingTimeout, withDeadline } from "../deadline";
import { PROJECT_ROOT } from "../project-paths";
import { restoreProjectSnapshot, saveProjectSnapshot } from "./storage";

const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 120_000;
const projectSandboxes = new Map<string, Sandbox>();
const pendingAcquisitions = new Map<string, Promise<Sandbox>>();

type PackageManifest = {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

const starterManifest = JSON.parse(reactStarterFiles["package.json"] ?? "{}") as PackageManifest;
const requiredPackages = {
    dependencies: starterManifest.dependencies ?? {},
    devDependencies: Object.fromEntries(
        Object.entries(starterManifest.devDependencies ?? {}).filter(([name]) =>
            !name.startsWith("@testing-library/") && name !== "jsdom" && name !== "vitest",
        ),
    ),
};
const checkCommand = "if [ -x node_modules/.bin/vite ] && [ -x node_modules/.bin/tsc ]; then printf installed; else printf missing; fi";

async function seedReactStarter(sandbox: Sandbox) {
    if (await sandbox.files.exists(`${PROJECT_ROOT}/package.json`)) return;

    for (const [path, content] of Object.entries(reactStarterFiles)) {
        await sandbox.files.write(`${PROJECT_ROOT}/${path}`, content);
    }
}

async function restoreOrSeedWorkspace(sandbox: Sandbox, projectId: string) {
    await sandbox.commands.run(`mkdir -p ${PROJECT_ROOT}`, { timeoutMs: 10_000 });
    const deadlineAt = Date.now() + 60_000;
    const restored = await restoreProjectSnapshot(sandbox, projectId, deadlineAt);
    if (!restored) await seedReactStarter(sandbox);
}

async function createOrReconnect(projectId: string): Promise<Sandbox> {
    const matches = Sandbox.list({
        query: { metadata: { tyox_project_id: projectId } },
        order: "desc",
        limit: 1,
    });
    const [existing] = await matches.nextItems();

    if (existing) {
        let sandbox: Sandbox | undefined;
        try {
            sandbox = await Sandbox.connect(existing.sandboxId);
        } catch (error) {
            // Expiry between list and connect is expected; other failures should surface.
            if (!(error instanceof SandboxNotFoundError)) throw error;
        }
        if (sandbox) {
            if (!await sandbox.files.exists(`${PROJECT_ROOT}/package.json`)) {
                await restoreOrSeedWorkspace(sandbox, projectId);
            }
            return sandbox;
        }
    }

    const sandbox = await Sandbox.create({
        metadata: { tyox_project_id: projectId },
        timeoutMs: SANDBOX_TIMEOUT_MS,
        allowInternetAccess: true,
    });
    try {
        await restoreOrSeedWorkspace(sandbox, projectId);
    } catch (error) {
        await sandbox.kill().catch(() => {});
        throw error;
    }
    return sandbox;
}

async function acquireSandbox(projectId: string): Promise<Sandbox> {
    const cached = projectSandboxes.get(projectId);
    if (cached) {
        try {
            await cached.setTimeout(SANDBOX_TIMEOUT_MS);
            return cached;
        } catch (error) {
            if (!(error instanceof SandboxNotFoundError)) throw error;
            projectSandboxes.delete(projectId);
        }
    }

    const sandbox = await createOrReconnect(projectId);
    await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);
    projectSandboxes.set(projectId, sandbox);
    return sandbox;
}

export function getProjectSandbox(projectId: string): Promise<Sandbox> {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
        throw new Error("Invalid project ID");
    }
    if (!process.env.E2B_API_KEY) {
        throw new Error("E2B_API_KEY is missing. Add it to agent/.env to use project workspaces.");
    }

    const pending = pendingAcquisitions.get(projectId);
    if (pending) return pending;

    // Store the promise before yielding so callers share creation AND timeout refresh.
    const acquisition = acquireSandbox(projectId).finally(() => {
        if (pendingAcquisitions.get(projectId) === acquisition) {
            pendingAcquisitions.delete(projectId);
        }
    });
    pendingAcquisitions.set(projectId, acquisition);
    return acquisition;
}

export async function ensureProjectDependencies(sandbox: Sandbox, deadlineAt: number): Promise<boolean> {
    let manifest: PackageManifest;
    try {
        manifest = JSON.parse(await withDeadline(sandbox.files.read(`${PROJECT_ROOT}/package.json`), deadlineAt)) as PackageManifest;
    } catch {
        throw new Error("The project workspace has no valid package.json.");
    }

    let manifestChanged = false;
    manifest.scripts ??= {};
    if (!manifest.scripts["test:e2e"]) {
        manifest.scripts["test:e2e"] = "playwright test";
        manifestChanged = true;
    }
    for (const [section, required] of Object.entries(requiredPackages) as Array<["dependencies" | "devDependencies", Record<string, string>]>) {
        const packages = { ...manifest[section] };
        for (const [name, version] of Object.entries(required)) {
            if (!packages[name]) {
                packages[name] = version;
                manifestChanged = true;
            }
        }
        manifest[section] = packages;
    }

    if (manifestChanged) {
        await withDeadline(sandbox.files.write(`${PROJECT_ROOT}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`), deadlineAt);
    }

    await withDeadline(sandbox.commands.run("mkdir -p e2e", {
        cwd: PROJECT_ROOT,
        timeoutMs: remainingTimeout(deadlineAt, 10_000),
    }), deadlineAt);
    for (const path of ["playwright.config.ts", "e2e/smoke.spec.ts"]) {
        if (!await sandbox.files.exists(`${PROJECT_ROOT}/${path}`)) {
            const contents = reactStarterFiles[path];
            if (contents) await withDeadline(sandbox.files.write(`${PROJECT_ROOT}/${path}`, contents), deadlineAt);
        }
    }

    const installStatus = await withDeadline(sandbox.commands.run(checkCommand, {
        cwd: PROJECT_ROOT,
        timeoutMs: remainingTimeout(deadlineAt, 10_000),
    }), deadlineAt);
    const wasInstalled = installStatus.stdout.trim() === "installed";

    if (!wasInstalled || manifestChanged) {
        try {
            const install = sandbox.commands.run("npm install --no-audit --no-fund --package-lock=false --legacy-peer-deps", {
                cwd: PROJECT_ROOT,
                timeoutMs: remainingTimeout(deadlineAt, INSTALL_TIMEOUT_MS),
            });
            await withDeadline(install, deadlineAt);
        } catch (error) {
            const detail = error instanceof CommandExitError
                ? [error.message, error.stderr, error.stdout].filter(Boolean).join("\n").slice(-1200)
                : error instanceof Error ? error.message : String(error);
            throw new Error(`Could not install the React workspace packages: ${detail}`);
        }
    }

    const finalCheck = await withDeadline(sandbox.commands.run(checkCommand, {
        cwd: PROJECT_ROOT,
        timeoutMs: remainingTimeout(deadlineAt, 10_000),
    }), deadlineAt);
    if (finalCheck.stdout.trim() !== "installed") {
        throw new Error("Workspace package installation finished, but Vite or the configured TypeScript compiler is still missing.");
    }
    return !wasInstalled || manifestChanged;
}

export async function initializeProjectWorkspace(projectId: string, deadlineAt: number) {
    const sandbox = await getProjectSandbox(projectId);
    const installedPackages = await ensureProjectDependencies(sandbox, deadlineAt);
    await saveProjectSnapshot(sandbox, projectId, deadlineAt);
    return { installedPackages };
}

export { PROJECT_ROOT };
