import type { Sandbox } from "e2b";
import { PROJECT_ROOT } from "../config";
import { errorMessage, timed, timeLeft } from "../utils";
import { getProjectSandbox, installDependencies } from "./manager";

const COMMAND_TIMEOUT_MS = 120_000;
// e2b's default sandbox only has about 470mb of ram and chromium crashes without swap
const ADD_SWAP = "test -f /swapfile || (sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile)";

async function runCheck(sandbox: Sandbox, projectId: string, name: string, command: string, deadline: number) {
    try {
        await timed(projectId, name, () =>
            sandbox.commands.run(command, {
                cwd: PROJECT_ROOT,
                timeoutMs: timeLeft(deadline, COMMAND_TIMEOUT_MS),
            }),
        );
    } catch (error) {
        throw new Error(`${name} failed. ${errorMessage(error)}`);
    }
}

export async function runTestsAndBuild(projectId: string, sendUpdate: (message: string) => void, deadline: number) {
    const sandbox = await getProjectSandbox(projectId);
    await installDependencies(sandbox, projectId, deadline);

    // run the build even when the tests fail, so the model gets every error in one repair prompt.
    // stopping at the first failure hid build errors until the only repair attempt was used up
    const failures: string[] = [];

    sendUpdate("Running project tests...");
    try {
        await runCheck(sandbox, projectId, "Project tests", "./node_modules/.bin/vitest run src", deadline);
    } catch (error) {
        failures.push(errorMessage(error));
    }

    sendUpdate("Building the project...");
    try {
        await runCheck(sandbox, projectId, "Project build", "npm run build", deadline);
    } catch (error) {
        failures.push(errorMessage(error));
    }

    if (failures.length > 0) throw new Error(failures.join("\n\n"));
}

// needs the preview server running because playwright opens the real app
export async function runBrowserChecks(projectId: string, sendUpdate: (message: string) => void, deadline: number) {
    const sandbox = await getProjectSandbox(projectId);

    sendUpdate("Checking the running app in Chromium...");
    await runCheck(sandbox, projectId, "Adding swap", ADD_SWAP, deadline);
    await runCheck(sandbox, projectId, "Chromium install", "./node_modules/.bin/playwright install --with-deps chromium", deadline);
    await runCheck(sandbox, projectId, "Browser checks", "./node_modules/.bin/playwright test --reporter=line 2>&1", deadline);
}
