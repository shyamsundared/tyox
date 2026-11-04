export const AGENT_RUN_TIMEOUT_MS = 5 * 60 * 1000;

export class AgentTimeoutError extends Error {
    constructor() {
        super("The agent request exceeded its 5-minute time limit. Try a smaller request.");
        this.name = "AgentTimeoutError";
    }
}

export function remainingTimeout(deadlineAt: number, maximumMs: number): number {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new AgentTimeoutError();
    return Math.min(remaining, maximumMs);
}

// This bounds the wait. The caller must cancel external work through its SDK.
export async function withDeadline<T>(operation: Promise<T>, deadlineAt: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                const timeoutMs = remainingTimeout(deadlineAt, Number.MAX_SAFE_INTEGER);
                timer = setTimeout(() => reject(new AgentTimeoutError()), timeoutMs);
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}
