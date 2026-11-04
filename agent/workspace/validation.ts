import { CommandExitError } from "e2b";
import { ensureProjectDependencies, getProjectSandbox, PROJECT_ROOT } from "./manager";
import type { UpdateEvent } from "../../shared/agent-events";
import { remainingTimeout, withDeadline } from "../deadline";

const COMMAND_TIMEOUT_MS = 120_000;
const DIAGNOSTIC_LIMIT = 6000;

type UpdateEmitter = (event: UpdateEvent) => Promise<void>;
type ValidationStage = "tests" | "build" | "browser";
type ValidationObserver = (stage: ValidationStage, status: "passed" | "failed" | "skipped") => void;

function commandOutput(error: unknown): string {
    if (!(error instanceof CommandExitError)) {
        return error instanceof Error ? error.message : String(error);
    }
    const output = [error.stderr, error.stdout, error.error].filter(Boolean).join("\n").trim();
    return `Command exited with status ${error.exitCode}${output ? `:\n${output.slice(-DIAGNOSTIC_LIMIT)}` : ""}`;
}

export async function validateProject(
    projectId: string,
    emit: UpdateEmitter,
    deadlineAt: number,
    observe: ValidationObserver = () => {},
): Promise<void> {
    const sandbox = await withDeadline(getProjectSandbox(projectId), deadlineAt);
    console.info(JSON.stringify({
        event: "project_validation_started",
        projectId,
        sandboxId: sandbox.sandboxId,
    }));
    await ensureProjectDependencies(sandbox, deadlineAt);

    const vitest = await withDeadline(sandbox.commands.run(
        "if [ -x node_modules/.bin/vitest ]; then printf installed; else printf missing; fi",
        { cwd: PROJECT_ROOT, timeoutMs: remainingTimeout(deadlineAt, COMMAND_TIMEOUT_MS) },
    ), deadlineAt);

    if (vitest.stdout.trim() === "installed") {
        await emit({ event: "update", data: { message: "Running project tests with Vitest…" } });
        try {
            const tests = sandbox.commands.run("./node_modules/.bin/vitest run src", {
                cwd: PROJECT_ROOT,
                timeoutMs: remainingTimeout(deadlineAt, COMMAND_TIMEOUT_MS),
            });
            await withDeadline(tests, deadlineAt);
            observe("tests", "passed");
        } catch (error) {
            observe("tests", "failed");
            throw new Error(`Project tests failed. ${commandOutput(error)}`);
        }
    } else {
        observe("tests", "skipped");
        await emit({
            event: "update",
            data: { message: "Vitest is not installed in this workspace, so tests were skipped. Continuing with the production build…" },
        });
    }

    await emit({ event: "update", data: { message: "Building the project…" } });
    try {
        const build = sandbox.commands.run("npm run build", {
            cwd: PROJECT_ROOT,
            timeoutMs: remainingTimeout(deadlineAt, COMMAND_TIMEOUT_MS),
        });
        await withDeadline(build, deadlineAt);
        observe("build", "passed");
    } catch (error) {
        observe("build", "failed");
        throw new Error(`Project build failed after tests passed. ${commandOutput(error)}`);
    }
}

export async function validateProjectInBrowser(
    projectId: string,
    emit: UpdateEmitter,
    deadlineAt: number,
    observe: ValidationObserver = () => {},
): Promise<void> {
    const sandbox = await withDeadline(getProjectSandbox(projectId), deadlineAt);

    await emit({ event: "update", data: { message: "Preparing Chromium for browser checks…" } });
    try {
        const browser = await withDeadline(sandbox.commands.run(
            "node -e 'const fs=require(\"node:fs\");const {chromium}=require(\"playwright\");process.stdout.write(fs.existsSync(chromium.executablePath())?\"installed\":\"missing\")'",
            { cwd: PROJECT_ROOT, timeoutMs: remainingTimeout(deadlineAt, 10_000) },
        ), deadlineAt);

        if (browser.stdout.trim() !== "installed") {
            try {
                await withDeadline(sandbox.commands.run("./node_modules/.bin/playwright install chromium", {
                    cwd: PROJECT_ROOT,
                    timeoutMs: remainingTimeout(deadlineAt, COMMAND_TIMEOUT_MS),
                }), deadlineAt);
            } catch (error) {
                throw new Error(`Could not install Chromium for Playwright. ${commandOutput(error)}`);
            }
        }

        await emit({ event: "update", data: { message: "Checking the running app in Chromium…" } });
        const browserTests = await withDeadline(sandbox.commands.run(
            "set +e; ./node_modules/.bin/playwright test --reporter=line > /tmp/tyox-playwright.log 2>&1; status=$?; printf '__TYOX_PLAYWRIGHT_EXIT_CODE__=%s\\n' \"$status\"; cat /tmp/tyox-playwright.log; exit 0",
            {
            cwd: PROJECT_ROOT,
            timeoutMs: remainingTimeout(deadlineAt, COMMAND_TIMEOUT_MS),
            },
        ), deadlineAt);
        const exitCode = browserTests.stdout.match(/^__TYOX_PLAYWRIGHT_EXIT_CODE__=(\d+)$/m)?.[1];
        if (exitCode !== "0") {
            const details = browserTests.stdout
                .replace(/^__TYOX_PLAYWRIGHT_EXIT_CODE__=\d+\s*/m, "")
                .trim()
                .slice(-DIAGNOSTIC_LIMIT);
            throw new Error(`Playwright exited with status ${exitCode ?? "unknown"}${details ? `:\n${details}` : " without command output"}`);
        }
        observe("browser", "passed");
    } catch (error) {
        observe("browser", "failed");
        throw new Error(`Project browser checks failed. ${commandOutput(error)}`);
    }
}
