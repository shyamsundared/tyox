import { WRITE_TOOL } from "./tools/definitions";
import type { Step } from "./types";

// we stay on the gemini free tier so requests have to be small.
// roughly 24k tokens, assuming about 3 characters per token
const MAX_HISTORY_CHARS = 72_000;
const KEEP_LAST_TURNS = 2;
const KEEP_LAST_WRITES = 2;
const KEEP_LAST_RESULTS = 2;

function historySize(history: Step[]): number {
    return JSON.stringify(history).length;
}

// when history gets too big, throw away the old stuff and keep what the model
// needs to continue: the first request, the recent turns and the latest tool results
export function trimHistory(history: Step[]): Step[] {
    if (historySize(history) <= MAX_HISTORY_CHARS) return history;

    const firstStep = history[0];
    const turnStarts = history.flatMap((step, index) => (step.type === "user_input" ? [index] : []));
    const lastTurnsStart = turnStarts[turnStarts.length - KEEP_LAST_TURNS] ?? 0;
    let trimmed = lastTurnsStart > 0 && firstStep ? [firstStep, ...history.slice(lastTurnsStart)] : history;

    trimmed = trimmed.filter((step) => step.type !== "thought");

    // a write call holds the whole file, so old ones are the biggest thing in history.
    // gemini needs every call to have a result, so we remove both together
    const writeCalls = trimmed.filter((step) => step.type === "function_call" && step.name === WRITE_TOOL.name);
    const oldWriteIds = new Set(
        writeCalls.slice(0, -KEEP_LAST_WRITES).flatMap((step) => (step.type === "function_call" ? [step.id] : [])),
    );
    trimmed = trimmed.filter((step) => {
        if (step.type === "function_call") return !oldWriteIds.has(step.id);
        if (step.type === "function_result") return !oldWriteIds.has(step.call_id);
        return true;
    });

    const results = trimmed.filter((step) => step.type === "function_result");
    const oldResults = new Set<Step>(results.slice(0, -KEEP_LAST_RESULTS));
    trimmed = trimmed.map((step) => {
        if (step.type !== "function_result" || !oldResults.has(step)) return step;
        return { ...step, result: { output: "[Old tool output removed to save space.]" } };
    });

    if (historySize(trimmed) > MAX_HISTORY_CHARS) {
        throw new Error("This request is too large for the agent to handle. Try a smaller one.");
    }
    return trimmed;
}
