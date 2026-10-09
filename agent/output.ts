import {
    bashToolDefinition,
    createTodosToolDefinition,
    questionToolDefinition,
    readToolDefinition,
    writeToolDefinition,
} from "./tooldefinition";
import type { FunctionResultStep, Step, UserInputStep } from "./types";
import { client } from "./types";
import type { Tool } from "./types";
import { bashTool, createTodosTool, readTool, writeTool } from "./toolabs";
import type { AgentClientEvent, CompleteEvent, PreviewEvent, QuestionEvent, UpdateEvent } from "../shared/agent-events";
import { startProjectPreview } from "./preview";
import { validateProject } from "./validation";
import { AGENT_RUN_TIMEOUT_MS, remainingTimeout, timeoutError, withDeadline } from "./deadline";
import { AGENT_MODEL, AGENT_SYSTEM_INSTRUCTION, AGENT_TOOL_DEFINITIONS, MAX_CONTEXT_TOKENS, prepareAgentContext } from "./context";
import { getProjectSandbox } from "./workspace";
import { isProjectStorageEnabled, saveProjectSnapshot } from "./storage";

export type WaitingForUser = {
    state: "waiting_for_user";
    convo_id: string;
    question: string;
    call_id: string;
    tool_name: string;
    project_id: string;
    history: Step[];
};

type PendingRun = Pick<WaitingForUser, "history" | "call_id" | "tool_name" | "project_id" | "question">;
export type AgentRunEvent =
    | (QuestionEvent & { pendingRun: PendingRun })
    | (CompleteEvent & { conversationId: string })
    | Extract<AgentClientEvent, { event: "error" }>
    | PreviewEvent
    | UpdateEvent;
export type AgentEventEmitter = (event: AgentRunEvent) => Promise<void>;

const tools = new Map<string, Tool>([
    [bashToolDefinition.name, bashTool],
    [readToolDefinition.name, readTool],
    [writeToolDefinition.name, writeTool],
    [createTodosToolDefinition.name, createTodosTool],
]);

const MAX_PREVIEW_REPAIR_ATTEMPTS = 1;
// The wall-clock deadline is the primary bound. These limits catch a model
// that keeps asking for tiny actions without making useful progress.
const MAX_AGENT_TURNS = 16;
const MAX_AGENT_TOOL_CALLS = 24;
const GEMINI_REQUEST_TIMEOUT_MS = 120_000;
const GEMINI_PROGRESS_INTERVAL_MS = 10_000;

async function saveWorkspaceCheckpoint(
    projectId: string,
    deadlineAt: number,
    emit: AgentEventEmitter,
): Promise<string | null> {
    const sandbox = await withDeadline(getProjectSandbox(projectId), deadlineAt);
    const version = await saveProjectSnapshot(sandbox, projectId, deadlineAt);
    if (version) {
        await emit({ event: "update", data: { message: "Saved a project snapshot to S3." } });
    }
    return version;
}

async function requestNextTurn(
    history: Step[],
    convo_id: string,
    project_id: string,
    turn: number,
    deadlineAt: number,
    emit: AgentEventEmitter,
) {
    const controller = new AbortController();
    const startedAt = Date.now();
    let timedOut = false;
    const requestTimeoutMs = remainingTimeout(deadlineAt, GEMINI_REQUEST_TIMEOUT_MS);
    const runDeadlineIsLimiting = deadlineAt - startedAt <= GEMINI_REQUEST_TIMEOUT_MS;

    await emit({
        event: "update",
        data: {
            message: turn === 1
                ? "Agent is planning the requested page…"
                : "Agent is reviewing the project and deciding the next step…",
        },
    });
    console.info(JSON.stringify({ event: "gemini_request_started", conversationId: convo_id, projectId: project_id, turn }));

    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, requestTimeoutMs);
    const progress = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        void emit({
            event: "update",
            data: { message: `Agent is still working… (${seconds}s)` },
        }).catch(() => {});
    }, GEMINI_PROGRESS_INTERVAL_MS);

    try {
        await emit({
            event: "update",
            data: { message: `Checking recent context against the ${MAX_CONTEXT_TOKENS.toLocaleString()}-token limit…` },
        });
        const context = await prepareAgentContext(history, deadlineAt);
        history.splice(0, history.length, ...context.history);
        await emit({
            event: "update",
            data: {
                message: context.compacted
                    ? context.tokenCountIsUpperBound
                        ? "Reduced older context to stay safely under the token limit."
                        : `Reduced context from ${context.originalTokenCount.toLocaleString()} to ${context.tokenCount.toLocaleString()} tokens.`
                    : context.tokenCountIsUpperBound
                        ? "Context size is safely under the token limit."
                        : `Context ready: ${context.tokenCount.toLocaleString()} of ${MAX_CONTEXT_TOKENS.toLocaleString()} tokens.`,
            },
        });
        const response = await client.interactions.create({
            model: AGENT_MODEL,
            input: history,
            system_instruction: AGENT_SYSTEM_INSTRUCTION,
            tools: AGENT_TOOL_DEFINITIONS,
        }, { signal: controller.signal });
        console.info(JSON.stringify({
            event: "gemini_request_completed",
            conversationId: convo_id,
            projectId: project_id,
            turn,
            durationMs: Date.now() - startedAt,
        }));
        return response;
    } catch (error) {
        console.error(JSON.stringify({
            event: "gemini_request_failed",
            conversationId: convo_id,
            projectId: project_id,
            turn,
            durationMs: Date.now() - startedAt,
            timedOut,
            errorName: error instanceof Error ? error.name : "unknown",
        }));
        if (timedOut && runDeadlineIsLimiting) {
            throw timeoutError();
        }
        if (timedOut) {
            throw new Error(`Gemini did not respond within ${GEMINI_REQUEST_TIMEOUT_MS / 1000} seconds. The request was cancelled; you can try again.`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
        clearInterval(progress);
    }
}

function describeToolAction(name: string, args: Record<string, unknown>): string {
    if (name === writeToolDefinition.name && typeof args.path === "string") {
        return `Updating ${args.path}…`;
    }
    if (name === readToolDefinition.name && typeof args.path === "string") {
        return `Reading ${args.path}…`;
    }
    if (name === bashToolDefinition.name) return "Running a project command…";
    if (name === createTodosToolDefinition.name) return "Updating the task list…";
    return "Working on the project…";
}

function describeToolCompletion(name: string, args: Record<string, unknown>): string {
    if (name === writeToolDefinition.name && typeof args.path === "string") {
        return `Updated ${args.path}.`;
    }
    if (name === readToolDefinition.name && typeof args.path === "string") {
        return `Read ${args.path}.`;
    }
    if (name === bashToolDefinition.name) return "Project command finished.";
    if (name === createTodosToolDefinition.name) return "Task list updated.";
    return "Action finished.";
}

export async function main(
    input: string,
    ctx: string[],
    convo_id: string,
    project_id: string,
    emit: AgentEventEmitter,
): Promise<void> {
    const history: Step[] = ctx.map((text): UserInputStep => ({
        type: "user_input",
        content: [{ text, type: "text" }],
    }));
    history.push({
        type: "user_input",
        content: [{ text: input, type: "text" }],
    });

    await runLoop(history, convo_id, project_id, emit);
}

export async function resume(
    history: Step[],
    convo_id: string,
    call_id: string,
    tool_name: string,
    project_id: string,
    answer: string,
    emit: AgentEventEmitter,
): Promise<void> {
    const resultStep: FunctionResultStep = {
        type: "function_result",
        name: tool_name,
        call_id,
        result: { output: answer },
    };
    history.push(resultStep);
    await runLoop(history, convo_id, project_id, emit);
}

async function runLoop(
    history: Step[],
    convo_id: string,
    project_id: string,
    emit: AgentEventEmitter,
): Promise<void> {
    const deadlineAt = Date.now() + AGENT_RUN_TIMEOUT_MS;
    await withDeadline(runLoopUntilDeadline(history, convo_id, project_id, emit, deadlineAt), deadlineAt);
}

async function runLoopUntilDeadline(
    history: Step[],
    convo_id: string,
    project_id: string,
    emit: AgentEventEmitter,
    deadlineAt: number,
): Promise<void> {
    let previewRepairAttempts = 0;
    let turn = 0;
    let storageWarning: string | null = null;

    let toolCalls = 0;
    agentLoop: while (true) {
        if (turn >= MAX_AGENT_TURNS) {
            throw new Error(`Agent stopped after ${MAX_AGENT_TURNS} model turns without finishing. Try a more specific request.`);
        }
        turn += 1;
        const response = await requestNextTurn(history, convo_id, project_id, turn, deadlineAt, emit);

        for (const step of response.steps) {
            history.push(step);
            if (step.type === "thought") {
                const summary = (step.summary ?? [])
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("")
                    .trim();

                if (summary && summary !== "undefined") {
                    await emit({
                        event: "update",
                        data: { message: summary },
                    });
                }
            }
            if (step.type === "function_call") {
                if (step.name === questionToolDefinition.name) {
                    try {
                        const version = await saveWorkspaceCheckpoint(project_id, deadlineAt, emit);
                        storageWarning = version === null && !isProjectStorageEnabled()
                            ? "S3 storage is not configured, so these changes are only in the active E2B workspace."
                            : null;
                    } catch (error) {
                        storageWarning = `S3 snapshot failed: ${error instanceof Error ? error.message : String(error)}`;
                        console.error(JSON.stringify({ event: "s3_snapshot_failed", projectId: project_id, error: storageWarning }));
                        await emit({ event: "update", data: { message: "Could not save the current project snapshot to S3." } });
                    }
                    if (storageWarning) {
                        await emit({ event: "update", data: { message: storageWarning } });
                    }
                    const question = step.arguments.question;
                    if (typeof question !== "string") {
                        throw new Error("Q&A tool call did not include a string question");
                    }
                    const pendingRun: PendingRun = {
                        question,
                        call_id: step.id,
                        tool_name: step.name,
                        project_id,
                        history,
                    };
                    await emit({
                        event: "question",
                        data: {
                            conversation_id: convo_id,
                            call_id: step.id,
                            question,
                        },
                        pendingRun,
                    });
                    return;
                }

                if (toolCalls >= MAX_AGENT_TOOL_CALLS) {
                    throw new Error(`Agent stopped after ${MAX_AGENT_TOOL_CALLS} tool actions without finishing.`);
                }
                toolCalls += 1;

                const tool = tools.get(step.name);
                let output: unknown;
                let toolFailed = false;
                await emit({
                    event: "update",
                    data: { message: describeToolAction(step.name, step.arguments) },
                });
                try {
                    if (!tool) throw new Error(`Unknown tool: ${step.name}`);
                    output = await withDeadline(
                        tool.execute({ ...step.arguments, project_id, _deadlineAt: deadlineAt }),
                        deadlineAt,
                    );
                } catch (error) {
                    toolFailed = true;
                    output = error instanceof Error ? error.message : String(error);
                }

                const returnedFailure = typeof output === "object"
                    && output !== null
                    && "success" in output
                    && output.success === false;

                if (toolFailed || returnedFailure) {
                    await emit({
                        event: "update",
                        data: { message: "That action failed; the agent is checking the error…" },
                    });
                } else {
                    await emit({
                        event: "update",
                        data: { message: describeToolCompletion(step.name, step.arguments) },
                    });
                }

                history.push({
                    type: "function_result",
                    name: step.name,
                    call_id: step.id,
                    result: { output },
                } as FunctionResultStep);
            }

            if (step.type === "model_output") {
                const message = (step.content ?? [])
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("");
                if (!message.trim()) throw new Error("Agent returned an empty response");
                try {
                    const version = await saveWorkspaceCheckpoint(project_id, deadlineAt, emit);
                    storageWarning = version === null && !isProjectStorageEnabled()
                        ? "S3 storage is not configured, so these changes are only in the active E2B workspace."
                        : null;
                    if (storageWarning) {
                        await emit({ event: "update", data: { message: storageWarning } });
                    }
                } catch (error) {
                    storageWarning = `S3 snapshot failed: ${error instanceof Error ? error.message : String(error)}`;
                    console.error(JSON.stringify({ event: "s3_snapshot_failed", projectId: project_id, error: storageWarning }));
                    await emit({ event: "update", data: { message: "Could not save the project snapshot to S3; continuing validation." } });
                }
                try {
                    await validateProject(project_id, emit, deadlineAt);
                    const url = await startProjectPreview(project_id, emit, deadlineAt);
                    await emit({ event: "preview", data: { url } });
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    if (previewRepairAttempts < MAX_PREVIEW_REPAIR_ATTEMPTS) {
                        previewRepairAttempts += 1;
                        await emit({
                            event: "update",
                            data: {
                                message: `Preview validation failed. Asking the agent to investigate and repair (attempt ${previewRepairAttempts}/${MAX_PREVIEW_REPAIR_ATTEMPTS})…`,
                            },
                        });
                        history.push({
                            type: "user_input",
                            content: [{
                                type: "text",
                                text: [
                                    "Tyox could not validate and preview the project after your last response.",
                                    `Validation error: ${reason}`,
                                    "Inspect the project and determine whether the test, build, or preview process failed. Fix the implementation while preserving relevant tests. Do not run tests or build yourself; Tyox will validate once more after this repair. Finish after the focused fix.",
                                ].join("\n"),
                            }],
                        } satisfies UserInputStep);
                        continue agentLoop;
                    }

                    await emit({
                        event: "update",
                        data: { message: "Preview validation still fails after the allowed repair attempts." },
                    });
                    await emit({
                        event: "complete",
                        data: {
                            message: `${message}\n\nI couldn't validate and start the app preview after ${MAX_PREVIEW_REPAIR_ATTEMPTS} repair attempts. Last error: ${reason}${storageWarning ? `\n\n${storageWarning}` : ""}`,
                        },
                        conversationId: convo_id,
                    });
                    return;
                }
                await emit({
                    event: "complete",
                    data: { message: storageWarning ? `${message}\n\n${storageWarning}` : message },
                    conversationId: convo_id,
                });
                return;
            }
        }
    }
}
