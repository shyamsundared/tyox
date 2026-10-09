import { CommandExitError, Sandbox } from "e2b";
import { reactStarterFiles } from "./react-starter";

const PROJECT_ROOT = "/tmp/tyox-project";
const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;
const projectSandboxes = new Map<string, Promise<Sandbox>>();

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

async function createOrReconnect(projectId: string): Promise<Sandbox> {
    const matches = Sandbox.list({
        query: { metadata: { tyox_project_id: projectId } },
        order: "desc",
        limit: 1,
    });
    const [existing] = await matches.nextItems();

    if (existing) {
        return Sandbox.connect(existing.sandboxId);
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
    await seedReactStarter(sandbox);
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

export async function initializeProjectWorkspace(projectId: string) {
    const sandbox = await getProjectSandbox(projectId);
    const dependencies = await sandbox.commands.run(
        "if [ -d node_modules ]; then printf installed; else printf missing; fi",
        { cwd: PROJECT_ROOT, timeoutMs: 10_000 },
    );
    if (dependencies.stdout.trim() !== "installed") {
        try {
            await sandbox.commands.run("npm install --no-audit --no-fund", {
                cwd: PROJECT_ROOT,
                timeoutMs: 120_000,
            });
        } catch (error) {
            const detail = error instanceof CommandExitError
                ? [error.message, error.stderr, error.stdout].filter(Boolean).join("\n").slice(-1200)
                : error instanceof Error ? error.message : String(error);
            throw new Error(`Could not install the React starter packages: ${detail}`);
        }
    }
    return { installedPackages: dependencies.stdout.trim() !== "installed" };
}

export { PROJECT_ROOT };
