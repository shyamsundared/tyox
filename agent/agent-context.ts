import { bashToolDefinition, questionToolDefinition, readToolDefinition, writeToolDefinition } from "./tools/definitions";
import type { Step } from "./agent-types";
import { client } from "./config";
import { withDeadline } from "./deadline";

export const AGENT_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
export const MAX_CONTEXT_TOKENS = 24_000;
const SAFE_SERIALIZED_CONTEXT_BYTES = 18_000;
const TOKEN_COUNT_TIMEOUT_MS = 8_000;

export type PreparedAgentContext = {
    history: Step[];
    tokenCount: number;
    originalTokenCount: number;
    compacted: boolean;
    tokenCountIsUpperBound: boolean;
};

export const AGENT_SYSTEM_INSTRUCTION = [
    "For coding requests, build or modify the existing React app to satisfy the user's request.",
    "For new page requests, build a polished, complete page with realistic content, clear visual hierarchy, and the core sections users expect for that kind of page. Avoid placeholder-only layouts or bare minimum demos.",
    "Keep the implementation focused on the request. Do not add unrelated features, dependencies, or excessive demo content.",
    "Preserve the existing project setup and working behavior outside the requested change.",
    "Do not rewrite package.json or remove the initialized React, Vite, TypeScript, Tailwind, or test setup. Preserve existing dependencies and scripts unless the user explicitly asks to change the project tooling.",
    "Before editing an existing source file, read its current contents. Always write complete valid source code; never copy context-compaction or omitted-content placeholders into project files.",
    "Add or update focused React Testing Library tests under src/ for requested behavior. For behavior that depends on real browser APIs (especially drag-and-drop), do not simulate incomplete browser events in jsdom; add a focused Playwright test under e2e/ and use real browser interactions such as page.dragTo. Keep the starter browser smoke test. Do not run tests or the production build yourself; Tyox runs those checks after implementation and may send one repair request if they fail.",
    "For questions that do not request code changes, answer directly without editing files. Keep the final response brief.",
].join(" ");

export const AGENT_TOOL_DEFINITIONS = [
    bashToolDefinition,
    readToolDefinition,
    writeToolDefinition,
    questionToolDefinition,
];

function splitTurns(history: Step[]): Step[][] {
    const turns: Step[][] = [];
    let current: Step[] = [];
    for (const step of history) {
        if (step.type === "user_input" && current.length) {
            turns.push(current);
            current = [];
        }
        current.push(step);
    }
    if (current.length) turns.push(current);
    return turns;
}

function cloneSteps(history: Step[]): Step[] {
    return JSON.parse(JSON.stringify(history)) as Step[];
}

function serializedContext(history: Step[]): string {
    return JSON.stringify({
        systemInstruction: AGENT_SYSTEM_INSTRUCTION,
        tools: AGENT_TOOL_DEFINITIONS,
        history,
    });
}

function serializedContextBytes(history: Step[]): number {
    return new TextEncoder().encode(serializedContext(history)).byteLength;
}

async function countContextTokens(history: Step[], deadlineAt: number): Promise<number | null> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOKEN_COUNT_TIMEOUT_MS);
    try {
        const count = await withDeadline(client.models.countTokens({
            model: AGENT_MODEL,
            contents: serializedContext(history),
            config: {
                abortSignal: controller.signal,
                httpOptions: {
                    timeout: TOKEN_COUNT_TIMEOUT_MS,
                    retryOptions: { attempts: 1 },
                },
            },
        }), deadlineAt);
        console.info(JSON.stringify({
            event: "agent_context_count_completed",
            tokenCount: count.totalTokens ?? null,
            durationMs: Date.now() - startedAt,
        }));
        return typeof count.totalTokens === "number" ? count.totalTokens : null;
    } catch (error) {
        if (Date.now() >= deadlineAt) throw error;
        console.warn(JSON.stringify({
            event: "agent_context_count_failed",
            durationMs: Date.now() - startedAt,
            errorName: error instanceof Error ? error.name : "unknown",
        }));
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function omitToolOutput(step: Step): void {
    if (step.type !== "function_result") return;
    const result = step.result as unknown;
    if (!result || typeof result !== "object") return;

    const resultRecord = result as Record<string, unknown>;
    const output = resultRecord.output;
    if (typeof output === "string") {
        resultRecord.output = "[Earlier tool output omitted to fit the context budget.]";
        return;
    }
    if (output && typeof output === "object" && "output" in output) {
        (output as Record<string, unknown>).output = "[Earlier tool output omitted to fit the context budget.]";
        return;
    }
    resultRecord.output = "[Earlier tool output omitted to fit the context budget.]";
}

function compactHistory(history: Step[]): Step[] {
    const turns = splitTurns(history);
    if (turns.length > 2) {
        const firstRequest = turns[0]?.[0];
        history = [
            ...(firstRequest ? [firstRequest] : []),
            ...turns.slice(-2).flat(),
        ];
    }

    history = history.filter((step) => step.type !== "thought");
    const writes = history.filter((step) => step.type === "function_call" && step.name === writeToolDefinition.name);
    const oldWrites = writes.slice(0, Math.max(0, writes.length - 2));
    const omittedWriteIds = new Set(oldWrites.flatMap((step) => step.type === "function_call" ? [step.id] : []));
    if (omittedWriteIds.size > 0) {
        history = history.filter((step) =>
            !(step.type === "function_call" && omittedWriteIds.has(step.id))
            && !(step.type === "function_result" && omittedWriteIds.has(step.call_id)),
        );
    }

    const results = history.filter((step) => step.type === "function_result");
    for (const step of results.slice(0, Math.max(0, results.length - 2))) omitToolOutput(step);
    return history;
}

export async function prepareAgentContext(history: Step[], deadlineAt: number): Promise<PreparedAgentContext> {
    let selected = cloneSteps(history);
    const initialBytes = serializedContextBytes(selected);
    if (initialBytes <= SAFE_SERIALIZED_CONTEXT_BYTES) {
        console.info(JSON.stringify({ event: "agent_context_ready", tokenUpperBound: initialBytes, maxTokens: MAX_CONTEXT_TOKENS }));
        return {
            history: selected,
            tokenCount: initialBytes,
            originalTokenCount: initialBytes,
            compacted: false,
            tokenCountIsUpperBound: true,
        };
    }

    const initialCount = await countContextTokens(selected, deadlineAt);
    const originalTokenCount = initialCount ?? initialBytes;
    if (initialCount !== null && initialCount <= MAX_CONTEXT_TOKENS) {
        console.info(JSON.stringify({ event: "agent_context_ready", tokenCount: initialCount, maxTokens: MAX_CONTEXT_TOKENS }));
        return {
            history: selected,
            tokenCount: initialCount,
            originalTokenCount,
            compacted: false,
            tokenCountIsUpperBound: false,
        };
    }

    selected = compactHistory(selected);
    const compactedBytes = serializedContextBytes(selected);

    const finalCount = await countContextTokens(selected, deadlineAt);
    if (finalCount !== null && finalCount > MAX_CONTEXT_TOKENS) {
        throw new Error(`Could not reduce the request below the ${MAX_CONTEXT_TOKENS.toLocaleString()}-token context budget.`);
    }
    if (finalCount === null && compactedBytes > SAFE_SERIALIZED_CONTEXT_BYTES) {
        throw new Error(`The current request is too large to fit the ${MAX_CONTEXT_TOKENS.toLocaleString()}-token context budget.`);
    }
    const tokenCount = finalCount ?? compactedBytes;

    console.info(JSON.stringify({
        event: "agent_context_compacted",
        originalStepCount: history.length,
        retainedStepCount: selected.length,
        tokenCount,
        tokenCountIsUpperBound: finalCount === null,
        maxTokens: MAX_CONTEXT_TOKENS,
    }));
    return {
        history: selected,
        tokenCount,
        originalTokenCount,
        compacted: true,
        tokenCountIsUpperBound: finalCount === null,
    };
}
