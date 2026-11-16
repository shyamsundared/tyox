import { CommandExitError } from "e2b";

const MAX_LOG_LENGTH = 6000;

// how long a step can take, without going past the deadline of the whole run
export function timeLeft(deadline: number, maxMs: number): number {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
        throw new Error("The agent hit its 5 minute limit. Try a smaller request.");
    }
    return Math.min(remaining, maxMs);
}

// runs one step and logs how long it took, so we can see where a run spends its time.
// grep the logs for "[timing]" to read them
export async function timed<T>(projectId: string, step: string, work: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    let ok = false;
    try {
        const result = await work();
        ok = true;
        return result;
    } finally {
        const ms = Math.round(performance.now() - startedAt);
        console.log(`[timing] project=${projectId} ok=${ok} ms=${ms} step=${step}`);
    }
}

export function errorMessage(error: unknown): string {
    if (error instanceof CommandExitError) {
        const output = [error.stderr, error.stdout].filter(Boolean).join("\n").trim();
        return `Command exited with status ${error.exitCode}:\n${output.slice(-MAX_LOG_LENGTH)}`;
    }
    return error instanceof Error ? error.message : String(error);
}
