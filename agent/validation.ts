import { CommandExitError } from "e2b";
import { ensureProjectDependencies, getProjectSandbox, PROJECT_ROOT } from "./workspace";
import type { UpdateEvent } from "../shared/agent-events";
import { remainingTimeout, withDeadline } from "./deadline";

const COMMAND_TIMEOUT_MS = 120_000;
const DIAGNOSTIC_LIMIT = 6000;

type UpdateEmitter = (event: UpdateEvent) => Promise<void>;
type ValidationObserver = (stage: "tests" | "build", status: "passed" | "failed" | "skipped") => void;

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
            const tests = sandbox.commands.run("./node_modules/.bin/vitest run", {
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
