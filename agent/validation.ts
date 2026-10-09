import { CommandExitError } from "e2b";
import { ensureProjectDependencies, getProjectSandbox, PROJECT_ROOT } from "./workspace";
import type { UpdateEvent } from "../shared/agent-events";
import { remainingTimeout, withDeadline } from "./deadline";

const COMMAND_TIMEOUT_MS = 120_000;
const DIAGNOSTIC_LIMIT = 6000;

type UpdateEmitter = (event: UpdateEvent) => Promise<void>;

function commandOutput(error: unknown): string {
    if (!(error instanceof CommandExitError)) {
        return error instanceof Error ? error.message : String(error);
    }
    const output = [error.stderr, error.stdout, error.error].filter(Boolean).join("\n").trim();
    return `Command exited with status ${error.exitCode}${output ? `:\n${output.slice(-DIAGNOSTIC_LIMIT)}` : ""}`;
}

async function readOptionalFile(sandbox: Awaited<ReturnType<typeof getProjectSandbox>>, path: string, deadlineAt: number) {
    try {
        return await withDeadline(sandbox.files.read(`${PROJECT_ROOT}/${path}`), deadlineAt);
    } catch {
        remainingTimeout(deadlineAt, COMMAND_TIMEOUT_MS);
        return null;
    }
}

async function ensureTestSetup(projectId: string, deadlineAt: number) {
    const sandbox = await withDeadline(getProjectSandbox(projectId), deadlineAt);
    if (!await readOptionalFile(sandbox, "vitest.config.ts", deadlineAt)) {
        await withDeadline(sandbox.files.write(`${PROJECT_ROOT}/vitest.config.ts`, `import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
  },
}));
`), deadlineAt);
    }

    if (!await readOptionalFile(sandbox, "src/test/setup.ts", deadlineAt)) {
        await withDeadline(sandbox.files.write(`${PROJECT_ROOT}/src/test/setup.ts`, `import "@testing-library/jest-dom/vitest";\n`), deadlineAt);
    }
}

export async function validateProject(projectId: string, emit: UpdateEmitter, deadlineAt: number): Promise<void> {
    const sandbox = await withDeadline(getProjectSandbox(projectId), deadlineAt);
    await ensureProjectDependencies(sandbox, deadlineAt);
    await ensureTestSetup(projectId, deadlineAt);

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
        } catch (error) {
            throw new Error(`Project tests failed. ${commandOutput(error)}`);
        }
    } else {
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
    } catch (error) {
        throw new Error(`Project build failed after tests passed. ${commandOutput(error)}`);
    }
}
