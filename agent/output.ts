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
import type { AgentClientEvent, CompleteEvent, QuestionEvent } from "../shared/agent-events";

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
    | Extract<AgentClientEvent, { event: "error" }>;
export type AgentEventEmitter = (event: AgentRunEvent) => Promise<void>;

const tools = new Map<string, Tool>([
    [bashToolDefinition.name, bashTool],
    [readToolDefinition.name, readTool],
    [writeToolDefinition.name, writeTool],
    [createTodosToolDefinition.name, createTodosTool],
]);

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
    while (true) {
        const response = await client.interactions.create({
            model: "gemini-3.5-flash-lite",
            input: history,
            tools: [
                bashToolDefinition,
                readToolDefinition,
                writeToolDefinition,
                questionToolDefinition,
                createTodosToolDefinition,
            ],
        });

        for (const step of response.steps) {
            history.push(step);

            if (step.type === "function_call") {
                if (step.name === questionToolDefinition.name) {
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

                const tool = tools.get(step.name);
                let output: unknown;
                try {
                    if (!tool) throw new Error(`Unknown tool: ${step.name}`);
                    output = await tool.execute({ ...step.arguments, project_id });
                } catch (error) {
                    output = error instanceof Error ? error.message : String(error);
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
                await emit({
                    event: "complete",
                    data: { message },
                    conversationId: convo_id,
                });
                return;
            }
        }
    }
}
