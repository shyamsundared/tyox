import { CommandExitError, Sandbox } from "e2b";
import { reactStarterFiles } from "./react-starter";
import { remainingTimeout, withDeadline } from "./deadline";
import { PROJECT_ROOT } from "./project-paths";
import { restoreProjectSnapshot, saveProjectSnapshot } from "./storage";

const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 120_000;
const projectSandboxes = new Map<string, Promise<Sandbox>>();

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

async function seedReactStarter(sandbox: Sandbox) {
    try {
        await sandbox.files.read(`${PROJECT_ROOT}/package.json`);
        return;
    } catch {
        // A missing package.json means this workspace has not been initialized yet.
    }

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
        const sandbox = await Sandbox.connect(existing.sandboxId);
        if (!await sandbox.files.exists(`${PROJECT_ROOT}/package.json`)) {
            await restoreOrSeedWorkspace(sandbox, projectId);
        }
        return sandbox;
    }

    const sandbox = await Sandbox.create({
        metadata: { tyox_project_id: projectId },
        timeoutMs: SANDBOX_TIMEOUT_MS,
        allowInternetAccess: true,
    });
    const setup = await sandbox.commands.run(`mkdir -p ${PROJECT_ROOT}`, { timeoutMs: 10_000 });
    if (setup.exitCode !== 0) {
        await sandbox.kill();
        throw new Error(`Could not create the project directory: ${setup.stderr || setup.stdout}`);
    }
    try {
        await restoreOrSeedWorkspace(sandbox, projectId);
    } catch (error) {
        await sandbox.kill().catch(() => {});
        throw error;
    }
    return sandbox;
}

export async function getProjectSandbox(projectId: string): Promise<Sandbox> {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
        throw new Error("Invalid project ID");
    }
    if (!process.env.E2B_API_KEY) {
        throw new Error("E2B_API_KEY is missing. Add it to agent/.env to use project workspaces.");
    }

    let sandboxPromise = projectSandboxes.get(projectId);
    if (!sandboxPromise) {
        sandboxPromise = createOrReconnect(projectId);
        projectSandboxes.set(projectId, sandboxPromise);
    }

    try {
        const sandbox = await sandboxPromise;
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);
        return sandbox;
    } catch (error) {
        projectSandboxes.delete(projectId);
        throw error;
    }
}

export function clearProjectSandboxCache(projectId: string) {
    projectSandboxes.delete(projectId);
}

export async function ensureProjectDependencies(sandbox: Sandbox, deadlineAt: number): Promise<boolean> {
    let manifest: PackageManifest;
    try {
        manifest = JSON.parse(await withDeadline(sandbox.files.read(`${PROJECT_ROOT}/package.json`), deadlineAt)) as PackageManifest;
    } catch {
        throw new Error("The project workspace has no valid package.json.");
    }

    let manifestChanged = false;
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

    const needsTypeScript = /\btsc\b/.test(manifest.scripts?.build ?? "");
    const checkCommand = `if [ -x node_modules/.bin/vite ]${needsTypeScript ? " && [ -x node_modules/.bin/tsc ]" : ""}; then printf installed; else printf missing; fi`;
    const check = await withDeadline(sandbox.commands.run(checkCommand, {
        cwd: PROJECT_ROOT,
        timeoutMs: remainingTimeout(deadlineAt, 10_000),
    }), deadlineAt);
    const wasInstalled = check.stdout.trim() === "installed";

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
