import type { AgentClientEvent } from "../shared/agent-events";
import { client, MODEL, RUN_TIMEOUT_MS } from "./config";
import { trimHistory } from "./context";
import { savePendingRun } from "./pending-run";
import { SYSTEM_PROMPT } from "./prompt";
import { ALL_TOOLS, BASH_TOOL, QUESTION_TOOL, READ_TOOL, WRITE_TOOL } from "./tools/definitions";
import { runTool } from "./tools/executor";
import type { FunctionResultStep, PendingRun, Step } from "./types";
import { errorMessage, timeLeft } from "./utils";
import { getProjectSandbox } from "./workspace/manager";
import { startProjectPreview } from "./workspace/preview";
import { isStorageEnabled, saveProjectSnapshot } from "./workspace/storage";
import { runBrowserChecks, runTestsAndBuild } from "./workspace/validation";

// the time limit is the main protection, these catch a model that keeps going without finishing
const MAX_TURNS = 16;
const MAX_TOOL_CALLS = 24;
const MAX_REPAIR_ATTEMPTS = 1;
const GEMINI_TIMEOUT_MS = 120_000;

type Emit = (event: AgentClientEvent) => void;

export async function startAgent(message: string, conversationId: string, projectId: string, emit: Emit) {
    const history: Step[] = [{ type: "user_input", content: [{ type: "text", text: message }] }];
    await runLoop(history, conversationId, projectId, emit);
}

// the model is waiting for the result of its Qna call, so the user's answer goes in as that result
export async function resumeAgent(pending: PendingRun, answer: string, conversationId: string, emit: Emit) {
    const answerStep: FunctionResultStep = {
        type: "function_result",
        name: pending.tool_name,
        call_id: pending.call_id,
        result: { output: answer },
    };
    await runLoop([...pending.history, answerStep], conversationId, pending.project_id, emit);
}

async function runLoop(history: Step[], conversationId: string, projectId: string, emit: Emit) {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    const sendUpdate = (message: string) => emit({ event: "update", data: { message } });
    let toolCalls = 0;
    let repairAttempts = 0;

    for (let turn = 1; turn <= MAX_TURNS; turn++) {
        sendUpdate(turn === 1 ? "Planning the requested page..." : "Reviewing the project...");
        history = trimHistory(history);
        const steps = await askGemini(history, sendUpdate, deadline);

        for (const step of steps) {
            history.push(step);

            if (step.type === "thought") {
                const summary = textFrom(step.summary).trim();
                if (summary) sendUpdate(summary);
            }

            if (step.type === "function_call" && step.name === QUESTION_TOOL.name) {
                const question = step.arguments.question;
                if (typeof question !== "string") throw new Error("Qna call did not include a question");

                await saveSnapshot(projectId, sendUpdate, deadline);
                await savePendingRun(conversationId, {
                    question,
                    call_id: step.id,
                    tool_name: step.name,
                    project_id: projectId,
                    history,
                });
                emit({ event: "question", data: { conversation_id: conversationId, call_id: step.id, question } });
                return;
            }

            if (step.type === "function_call") {
                toolCalls++;
                if (toolCalls > MAX_TOOL_CALLS) throw new Error(`Agent stopped after ${MAX_TOOL_CALLS} tool calls without finishing.`);

                sendUpdate(describeTool(step.name, step.arguments));
                const output = await runTool(step.name, step.arguments, projectId, deadline);
                if (!output.success) sendUpdate("That action failed, the agent is checking the error...");

                history.push({ type: "function_result", name: step.name, call_id: step.id, result: { output } } as FunctionResultStep);
            }

            if (step.type === "model_output") {
                const message = textFrom(step.content);
                if (!message.trim()) throw new Error("Agent returned an empty response");

                const storageWarning = await saveSnapshot(projectId, sendUpdate, deadline);
                try {
                    const previewUrl = await checkProject(projectId, sendUpdate, deadline);
                    emit({ event: "preview", data: { url: previewUrl } });
                } catch (error) {
                    const reason = errorMessage(error);
                    console.error(`Validation failed for project ${projectId}:`, reason);

                    // give the model one chance to fix what it built
                    if (repairAttempts < MAX_REPAIR_ATTEMPTS) {
                        repairAttempts++;
                        sendUpdate("Validation failed, asking the agent to fix it...");
                        history.push({ type: "user_input", content: [{ type: "text", text: repairPrompt(reason) }] });
                        break;
                    }

                    await finish(`I couldn't get the preview working after ${MAX_REPAIR_ATTEMPTS} repair attempt. The details are in the agent logs.`, storageWarning, conversationId, emit);
                    return;
                }

                await finish(message, storageWarning, conversationId, emit);
                return;
            }
        }
    }

    throw new Error(`Agent stopped after ${MAX_TURNS} turns without finishing. Try a more specific request.`);
}

async function askGemini(history: Step[], sendUpdate: (message: string) => void, deadline: number) {
    const startedAt = Date.now();
    // the response isn't streamed, so tell the user we're still alive during long requests
    const progress = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        sendUpdate(`Agent is still working... (${seconds}s)`);
    }, 10_000);

    try {
        const response = await client.interactions.create({
            model: MODEL,
            input: history,
            system_instruction: SYSTEM_PROMPT,
            tools: ALL_TOOLS,
        }, { signal: AbortSignal.timeout(timeLeft(deadline, GEMINI_TIMEOUT_MS)) });
        return response.steps;
    } finally {
        clearInterval(progress);
    }
}

// tests and build first, then the preview, then the browser checks against that preview
async function checkProject(projectId: string, sendUpdate: (message: string) => void, deadline: number): Promise<string> {
    await runTestsAndBuild(projectId, sendUpdate, deadline);
    const previewUrl = await startProjectPreview(projectId, sendUpdate, deadline);
    await runBrowserChecks(projectId, sendUpdate, deadline);
    return previewUrl;
}

// returns a warning for the user if the project could not be saved. a failed save shouldn't
// fail the run because the files are still in the sandbox
async function saveSnapshot(projectId: string, sendUpdate: (message: string) => void, deadline: number): Promise<string | null> {
    if (!isStorageEnabled()) {
        return "S3 storage is not configured, so these changes only exist in the E2B sandbox.";
    }
    try {
        const sandbox = await getProjectSandbox(projectId);
        await saveProjectSnapshot(sandbox, projectId, deadline);
        sendUpdate("Saved the project to S3.");
        return null;
    } catch (error) {
        console.error(`Could not save snapshot for project ${projectId}:`, errorMessage(error));
        return "The project could not be saved to S3. Your changes are still in the E2B sandbox.";
    }
}

async function finish(message: string, warning: string | null, conversationId: string, emit: Emit) {
    await savePendingRun(conversationId, null);
    emit({ event: "complete", data: { message: warning ? `${message}\n\n${warning}` : message } });
}

function textFrom(parts: { type: string; text?: string }[] | undefined): string {
    return (parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
}

function describeTool(name: string, args: Record<string, unknown>): string {
    if (name === WRITE_TOOL.name) return `Updating ${args.path}...`;
    if (name === READ_TOOL.name) return `Reading ${args.path}...`;
    if (name === BASH_TOOL.name) return "Running a project command...";
    return "Working on the project...";
}

function repairPrompt(reason: string): string {
    return `Tyox could not validate and preview the project after your last response.
Validation error: ${reason}
Inspect the project and determine whether the test, build, or preview process failed. Fix the implementation while preserving relevant tests. Do not run tests or build yourself; Tyox will validate once more after this repair. Finish after the focused fix.`;
}
