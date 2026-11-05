import { Sandbox, SandboxNotFoundError } from "e2b";
import { PROJECT_ROOT } from "../config";
import { timeLeft } from "../utils";
import { reactStarterFiles } from "./starter-files";
import { restoreProjectSnapshot } from "./storage";

const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 120_000;
const CHECK_INSTALLED = "test -x node_modules/.bin/vite && test -x node_modules/.bin/tsc && echo installed || echo missing";

const projectSandboxes = new Map<string, Sandbox>();

// bring back the saved project from s3, or start from the react template if it's a new one
async function setupProjectFiles(sandbox: Sandbox, projectId: string) {
    await sandbox.commands.run(`mkdir -p ${PROJECT_ROOT}`);

    const restored = await restoreProjectSnapshot(sandbox, projectId, Date.now() + 60_000);
    if (restored) return;

    for (const [path, content] of Object.entries(reactStarterFiles)) {
        await sandbox.files.write(`${PROJECT_ROOT}/${path}`, content);
    }
}

// the agent can restart while a sandbox is still alive, so look for one before creating another
async function connectToExistingSandbox(projectId: string): Promise<Sandbox | null> {
    const results = Sandbox.list({
        query: { metadata: { tyox_project_id: projectId } },
        order: "desc",
        limit: 1,
    });
    const [existing] = await results.nextItems();
    if (!existing) return null;

    try {
        return await Sandbox.connect(existing.sandboxId);
    } catch (error) {
        // it can expire right after we list it
        if (error instanceof SandboxNotFoundError) return null;
        throw error;
    }
}

async function createSandbox(projectId: string): Promise<Sandbox> {
    const sandbox = await Sandbox.create({
        metadata: { tyox_project_id: projectId },
        timeoutMs: SANDBOX_TIMEOUT_MS,
        allowInternetAccess: true,
    });
    try {
        await setupProjectFiles(sandbox, projectId);
    } catch (error) {
        await sandbox.kill().catch(() => {});
        throw error;
    }
    return sandbox;
}

// server.ts only allows one run per project, so two calls can't race here
export async function getProjectSandbox(projectId: string): Promise<Sandbox> {
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

    let sandbox = await connectToExistingSandbox(projectId);
    if (sandbox) {
        const hasFiles = await sandbox.files.exists(`${PROJECT_ROOT}/package.json`);
        if (!hasFiles) await setupProjectFiles(sandbox, projectId);
    } else {
        sandbox = await createSandbox(projectId);
    }

    await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);
    projectSandboxes.set(projectId, sandbox);
    return sandbox;
}

// node_modules isn't saved in the s3 snapshot, so a restored project has to install again
export async function installDependencies(sandbox: Sandbox, deadline: number) {
    const check = await sandbox.commands.run(CHECK_INSTALLED, { cwd: PROJECT_ROOT });
    if (check.stdout.trim() === "installed") return;

    await sandbox.commands.run("npm install --no-audit --no-fund --package-lock=false --legacy-peer-deps", {
        cwd: PROJECT_ROOT,
        timeoutMs: timeLeft(deadline, INSTALL_TIMEOUT_MS),
    });
}
