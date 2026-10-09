import { ensureProjectDependencies, getProjectSandbox, PROJECT_ROOT } from "./workspace";
import type { PreviewEvent, UpdateEvent } from "../shared/agent-events";
import { CommandExitError } from "e2b";
import { remainingTimeout, withDeadline } from "./deadline";

const PREVIEW_PORT = 4173;
const PREVIEW_PROCESS_TIMEOUT_MS = 30 * 60 * 1000;
const DIAGNOSTIC_LOG_LIMIT = 6000;

type PackageJson = {
    scripts?: Record<string, unknown>;
};

type PreviewEmitter = (event: PreviewEvent | UpdateEvent) => Promise<void>;

function commandFailure(error: unknown): string {
    if (error instanceof CommandExitError) {
        const output = [error.stderr, error.stdout, error.error].filter(Boolean).join("\n").trim();
        return `Command exited with status ${error.exitCode}${output ? `: ${output.slice(-DIAGNOSTIC_LOG_LIMIT)}` : ""}`;
    }
    return error instanceof Error ? error.message : String(error);
}

export async function startProjectPreview(projectId: string, emit: PreviewEmitter, deadlineAt: number): Promise<string> {
    const sandbox = await withDeadline(getProjectSandbox(projectId), deadlineAt);
    await ensureProjectDependencies(sandbox, deadlineAt);
    let packageJson: PackageJson;
    try {
        packageJson = JSON.parse(await withDeadline(sandbox.files.read(`${PROJECT_ROOT}/package.json`), deadlineAt)) as PackageJson;
    } catch {
        throw new Error("I couldn't find a valid package.json in the project workspace.");
    }

    const scripts = packageJson.scripts ?? {};
    const scriptName = ["dev", "start"].find((name) => typeof scripts[name] === "string");
    if (!scriptName) {
        throw new Error("The project needs a 'dev' or 'start' script in package.json before it can be previewed.");
    }

    await emit({ event: "update", data: { message: "Preparing the app preview…" } });
    const script = String(scripts[scriptName]);
    const probePath = /\bvite\b/.test(script) ? "/src/main.tsx" : "/";
    const previewHost = sandbox.getHost(PREVIEW_PORT);
    const readyWaitMs = remainingTimeout(deadlineAt, 30_000);
    const readyCheck = `node -e 'const http=require("node:http");const until=Date.now()+${readyWaitMs};function check(){const req=http.get({hostname:"127.0.0.1",port:${PREVIEW_PORT},path:"${probePath}",headers:{host:"${previewHost}"}},r=>{let body="";r.on("data",chunk=>{if(body.length<${DIAGNOSTIC_LOG_LIMIT})body+=chunk});r.on("end",()=>{if(r.statusCode<500&&r.statusCode!==403){console.log("ready");return}console.log("error:"+r.statusCode+"\\n"+body);})});req.on("error",retry)}function retry(){if(Date.now()>until){console.log("timeout");return}setTimeout(check,500)}check()'`;
    const currentServerRequest = sandbox.commands.run(
        `node -e 'const http=require("node:http");const req=http.get({hostname:"127.0.0.1",port:${PREVIEW_PORT},path:"${probePath}",headers:{host:"${previewHost}"}},r=>{console.log(r.statusCode);r.resume()});req.on("error",()=>console.log("not-ready"))'`,
        { cwd: PROJECT_ROOT, timeoutMs: remainingTimeout(deadlineAt, 5_000) },
    );
    const currentServer = await withDeadline(currentServerRequest, deadlineAt);

    const currentStatus = currentServer.stdout.trim();
    if (currentStatus === "403" || /^5\d\d$/.test(currentStatus)) {
        const processes = await withDeadline(sandbox.commands.list(), deadlineAt);
        const previewProcesses = processes.filter((process) => {
            const command = [process.cmd, ...process.args].join(" ");
            return process.cwd === PROJECT_ROOT && (/\bvite\b/.test(command) || /\bnext\b/.test(command) || /npm run (dev|start)/.test(command));
        });
        for (const process of previewProcesses) {
            await withDeadline(sandbox.commands.kill(process.pid), deadlineAt).catch(() => false);
        }
    }

    if (!/^2\d\d$/.test(currentStatus) && !/^3\d\d$/.test(currentStatus) && !/^4(?!03)\d\d$/.test(currentStatus)) {
        let command: string;
        let envs: Record<string, string> | undefined;
        if (/\bvite\b/.test(script)) {
            command = `npm run ${scriptName} -- --host 0.0.0.0 --port ${PREVIEW_PORT} --strictPort`;
            envs = { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: previewHost };
        } else if (/\bnext\b/.test(script)) {
            command = `npm run ${scriptName} -- --hostname 0.0.0.0 --port ${PREVIEW_PORT}`;
        } else {
            command = `HOST=0.0.0.0 PORT=${PREVIEW_PORT} npm run ${scriptName}`;
        }

        await emit({ event: "update", data: { message: "Starting the generated React app…" } });
        let serverOutput = "";
        try {
            const launch = sandbox.commands.run(command, {
                cwd: PROJECT_ROOT,
                background: true,
                timeoutMs: PREVIEW_PROCESS_TIMEOUT_MS,
                ...(envs ? { envs } : {}),
                onStdout: (output) => { serverOutput += output; },
                onStderr: (output) => { serverOutput += output; },
            });
            await withDeadline(launch, deadlineAt);
        } catch (error) {
            throw new Error(`Could not launch the React app. ${commandFailure(error)}`);
        }

        const readyCheckRequest = sandbox.commands.run(readyCheck, {
            cwd: PROJECT_ROOT,
            timeoutMs: remainingTimeout(deadlineAt, readyWaitMs + 5_000),
        });
        const ready = await withDeadline(readyCheckRequest, deadlineAt);
        if (ready.stdout.trim() !== "ready") {
            const output = serverOutput.trim();
            const diagnostic = ready.stdout.trim() === "timeout"
                ? "The entry point did not respond within 30 seconds."
                : ready.stdout.trim().slice(0, DIAGNOSTIC_LOG_LIMIT);
            throw new Error(`The app preview failed its entry-point check. ${diagnostic}${output ? ` Dev server output: ${output.slice(-1200)}` : " No server output was captured."}`);
        }
    }

    return `https://${previewHost}`;
}
