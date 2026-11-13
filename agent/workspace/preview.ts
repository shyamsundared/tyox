import type { Sandbox } from "e2b";
import { PROJECT_ROOT } from "../config";
import { timeLeft } from "../utils";
import { getProjectSandbox } from "./manager";

const PREVIEW_PORT = 4173;
const PREVIEW_TIMEOUT_MS = 30 * 60 * 1000;
const READY_CHECK_ATTEMPTS = 30;

// asks the dev server for the app's entry file. returns the http status, "000" means nothing is running.
// the host header matters because vite blocks hosts that aren't allowed with a 403
async function checkPreviewServer(sandbox: Sandbox, host: string, deadline: number): Promise<string> {
    const url = `http://127.0.0.1:${PREVIEW_PORT}/src/main.tsx`;
    const result = await sandbox.commands.run(
        `curl -s -m 3 -o /dev/null -w "%{http_code}" -H "Host: ${host}" ${url} || true`,
        { timeoutMs: timeLeft(deadline, 5_000) },
    );
    return result.stdout.trim();
}

function isWorking(status: string): boolean {
    return /^[234]\d\d$/.test(status) && status !== "403";
}

async function stopOldServer(sandbox: Sandbox) {
    const processes = await sandbox.commands.list();
    for (const process of processes) {
        const command = [process.cmd, ...process.args].join(" ");
        if (process.cwd === PROJECT_ROOT && /\bvite\b|npm run dev/.test(command)) {
            await sandbox.commands.kill(process.pid).catch(() => false);
        }
    }
}

export async function startProjectPreview(
    projectId: string,
    sendUpdate: (message: string) => void,
    deadline: number,
): Promise<string> {
    const sandbox = await getProjectSandbox(projectId);
    const host = sandbox.getHost(PREVIEW_PORT);
    const previewUrl = `https://${host}`;

    const status = await checkPreviewServer(sandbox, host, deadline);
    if (isWorking(status)) return previewUrl;
    if (status !== "000") await stopOldServer(sandbox);

    sendUpdate("Starting the generated React app...");
    let serverOutput = "";
    await sandbox.commands.run(`npm run dev -- --host 0.0.0.0 --port ${PREVIEW_PORT} --strictPort`, {
        cwd: PROJECT_ROOT,
        background: true,
        timeoutMs: PREVIEW_TIMEOUT_MS,
        envs: { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: host },
        onStdout: (output) => { serverOutput += output; },
        onStderr: (output) => { serverOutput += output; },
    });

    for (let attempt = 0; attempt < READY_CHECK_ATTEMPTS; attempt++) {
        const status = await checkPreviewServer(sandbox, host, deadline);
        if (isWorking(status)) return previewUrl;
        if (status !== "000") {
            throw new Error(`The preview server returned ${status}. Server output: ${serverOutput.slice(-1200)}`);
        }
        await Bun.sleep(1000);
    }

    throw new Error(`The preview server did not start in time. Server output: ${serverOutput.slice(-1200)}`);
}
