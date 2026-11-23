import { describe, expect, test } from "bun:test";
import { trimHistory } from "./context";
import { WRITE_TOOL } from "./tools/definitions";
import type { Step } from "./types";

// small builders so each test reads like a conversation. the sdk's Step type is a large union,
// so we build plain objects and cast them once here
function userInput(text: string): Step {
    return { type: "user_input", content: [{ type: "text", text }] } as Step;
}

function writeCall(id: string, content: string): Step {
    return { type: "function_call", id, name: WRITE_TOOL.name, arguments: { path: `src/${id}.tsx`, content } } as Step;
}

function writeResult(id: string): Step {
    return { type: "function_result", name: WRITE_TOOL.name, call_id: id, result: { output: `Wrote src/${id}.tsx` } } as Step;
}

function thought(text: string): Step {
    return { type: "thought", summary: [{ type: "text", text }] } as Step;
}

function callIds(history: Step[]): string[] {
    return history.flatMap((step) => (step.type === "function_call" ? [step.id] : []));
}

function resultIds(history: Step[]): string[] {
    return history.flatMap((step) => (step.type === "function_result" ? [step.call_id] : []));
}

// a history over the size limit: the request, then five big file writes
function bigHistory(): Step[] {
    const history: Step[] = [userInput("Build a sports news page")];
    for (let i = 1; i <= 5; i++) {
        history.push(thought(`planning step ${i}`));
        history.push(writeCall(`call-${i}`, "x".repeat(20_000)));
        history.push(writeResult(`call-${i}`));
    }
    return history;
}

describe("trimHistory", () => {
    test("leaves a small history untouched", () => {
        const history = [userInput("hi"), writeCall("call-1", "small"), writeResult("call-1")];
        expect(trimHistory(history)).toBe(history);
    });

    test("always keeps the user's original request as the first step", () => {
        const trimmed = trimHistory(bigHistory());
        expect(trimmed[0]).toEqual(userInput("Build a sports news page"));
    });

    test("never leaves a tool call without its result, or a result without its call", () => {
        const trimmed = trimHistory(bigHistory());
        // gemini rejects the request if these two lists don't match
        expect(callIds(trimmed)).toEqual(resultIds(trimmed));
    });

    test("drops the oldest file writes first and keeps the latest ones", () => {
        const trimmed = trimHistory(bigHistory());
        expect(callIds(trimmed)).toEqual(["call-4", "call-5"]);
    });

    test("removes thoughts, which the model doesn't need again", () => {
        const trimmed = trimHistory(bigHistory());
        expect(trimmed.some((step) => step.type === "thought")).toBe(false);
    });

    test("ends up under the size limit", () => {
        const trimmed = trimHistory(bigHistory());
        expect(JSON.stringify(trimmed).length).toBeLessThanOrEqual(72_000);
    });

    test("throws when even the essential steps are too big", () => {
        // trimming never removes the first request, so a huge request can't be made small enough
        expect(() => trimHistory([userInput("x".repeat(100_000))])).toThrow();
    });
});
