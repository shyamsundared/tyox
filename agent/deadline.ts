export const AGENT_RUN_TIMEOUT_MS = 5 * 60 * 1000;

export function timeoutError(): Error {
    return new Error("The agent request exceeded its 5-minute time limit. Try a smaller request.");
}

export function remainingTimeout(deadlineAt: number, maximumMs: number): number {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw timeoutError();
    return Math.min(remaining, maximumMs);
}

export async function withDeadline<T>(operation: Promise<T>, deadlineAt: number): Promise<T> {
    const timeoutMs = remainingTimeout(deadlineAt, Number.MAX_SAFE_INTEGER);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(timeoutError()), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
