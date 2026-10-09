import { getProjectSandbox, PROJECT_ROOT } from "./workspace";
import type { PreviewEvent, UpdateEvent } from "../shared/agent-events";
import { CommandExitError } from "e2b";

const PREVIEW_PORT = 4173;
const PREVIEW_PROCESS_TIMEOUT_MS = 30 * 60 * 1000;

type PackageJson = {
    scripts?: Record<string, unknown>;
};

type PreviewEmitter = (event: PreviewEvent | UpdateEvent) => Promise<void>;

function commandFailure(error: unknown): string {
    if (error instanceof CommandExitError) {
        const output = [error.stderr, error.stdout, error.error].filter(Boolean).join("\n").trim();
        return `Command exited with status ${error.exitCode}${output ? `: ${output.slice(-1200)}` : ""}`;
    }
    return error instanceof Error ? error.message : String(error);
}

export async function startProjectPreview(projectId: string, emit: PreviewEmitter): Promise<string> {
    const sandbox = await getProjectSandbox(projectId);
    let packageJson: PackageJson;
    try {
        packageJson = JSON.parse(await sandbox.files.read(`${PROJECT_ROOT}/package.json`)) as PackageJson;
    } catch {
        throw new Error("I couldn't find a valid package.json in the project workspace.");
    }

    const scripts = packageJson.scripts ?? {};
    const scriptName = ["dev", "start"].find((name) => typeof scripts[name] === "string");
    if (!scriptName) {
        throw new Error("The project needs a 'dev' or 'start' script in package.json before it can be previewed.");
    }

    await emit({ event: "update", data: { message: "Preparing the app preview…" } });
    const dependencies = await sandbox.commands.run("if [ -d node_modules ]; then printf installed; else printf missing; fi", {
        cwd: PROJECT_ROOT,
        timeoutMs: 10_000,
    });
    if (dependencies.stdout.trim() !== "installed") {
        await emit({ event: "update", data: { message: "Installing project dependencies…" } });
        try {
            await sandbox.commands.run("npm install --no-audit --no-fund", {
                cwd: PROJECT_ROOT,
                timeoutMs: 120_000,
            });
        } catch (error) {
            throw new Error(`Dependency installation failed. ${commandFailure(error)}`);
        }
    }

    const readyCheck = `node -e 'const until=Date.now()+30000; async function check(){try{const r=await fetch("http://127.0.0.1:${PREVIEW_PORT}");if(r.status<500){console.log("ready");return}}catch{}if(Date.now()>until){console.log("timeout");return}setTimeout(check,500)}check()'`;
    const previewHost = sandbox.getHost(PREVIEW_PORT);
    const currentServer = await sandbox.commands.run(
        `node -e 'const http=require("node:http");const req=http.get({hostname:"127.0.0.1",port:${PREVIEW_PORT},headers:{host:"${previewHost}"}},r=>{console.log(r.statusCode);r.resume()});req.on("error",()=>console.log("not-ready"))'`,
        { cwd: PROJECT_ROOT, timeoutMs: 5_000 },
    );

    const currentStatus = currentServer.stdout.trim();
    if (currentStatus === "403") {
        const processes = await sandbox.commands.list();
        const viteProcesses = processes.filter((process) => {
            const command = [process.cmd, ...process.args].join(" ");
            return process.cwd === PROJECT_ROOT && (/\bvite\b/.test(command) || /npm run dev/.test(command));
        });
        for (const process of viteProcesses) {
            await sandbox.commands.kill(process.pid).catch(() => false);
        }
    }

    if (!/^2\d\d$/.test(currentStatus) && !/^3\d\d$/.test(currentStatus) && !/^4(?!03)\d\d$/.test(currentStatus)) {
        const script = String(scripts[scriptName]);
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
            await sandbox.commands.run(command, {
                cwd: PROJECT_ROOT,
                background: true,
                timeoutMs: PREVIEW_PROCESS_TIMEOUT_MS,
                ...(envs ? { envs } : {}),
                onStdout: (output) => { serverOutput += output; },
                onStderr: (output) => { serverOutput += output; },
            });
        } catch (error) {
            throw new Error(`Could not launch the React app. ${commandFailure(error)}`);
        }

        const ready = await sandbox.commands.run(readyCheck, {
            cwd: PROJECT_ROOT,
            timeoutMs: 35_000,
        });
        if (ready.stdout.trim() !== "ready") {
            const output = serverOutput.trim();
            throw new Error(`The app did not start listening on its preview port within 30 seconds.${output ? ` Dev server output: ${output.slice(-1200)}` : " No server output was captured."}`);
        }
    }

    return `https://${previewHost}`;
}
