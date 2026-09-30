import { bashtool, qnatool, readtool, writetool } from "./tooldefinition";
import type { FunctionResultStep, Step, UserInputStep } from "./types";
import { client } from "./types";
import type { Tool } from "./types";
import { bash_t, read_t, write_t } from "./toolabs";

export type WaitingForUser = {
    state: "waiting_for_user";
    convo_id: string;
    question: string;
    call_id: string;
    tool_name: string;
    history: Step[];
};

export type AgentCompletion = { state: "completed"; history: Step[]; output: unknown };
export type AgentRunResult = WaitingForUser | AgentCompletion;

const tools = new Map<string, Tool>([
    [bashtool.name, bash_t],
    [readtool.name, read_t],
    [writetool.name, write_t],
]);

export async function main(input: string, ctx: string[], convo_id: string): Promise<AgentRunResult> {
    const history: Step[] = ctx.map((text): UserInputStep => ({
        type: "user_input",
        content: [{ text, type: "text" }],
    }));
    history.push({
        type: "user_input",
        content: [{ text: input, type: "text" }],
    });

    return runLoop(history, convo_id);
}

export async function resume(
    history: Step[],
    convo_id: string,
    call_id: string,
    tool_name: string,
    answer: string,
): Promise<AgentRunResult> {
    const resultStep: FunctionResultStep = {
        type: "function_result",
        name: tool_name,
        call_id,
        result: { output: answer },
    };
    history.push(resultStep);
    return runLoop(history, convo_id);
}

async function runLoop(history: Step[], convo_id: string): Promise<AgentRunResult> {
    while (true) {
        const response = await client.interactions.create({
            model: "gemini-3.5-flash-lite",
            input: history,
            tools: [bashtool, readtool, writetool, qnatool],
        });

        for (const step of response.steps) {
            history.push(step);

            if (step.type === "function_call") {
                if (step.name === qnatool.name) {
                    const question = step.arguments.question;
                    if (typeof question !== "string") {
                        throw new Error("Q&A tool call did not include a string question");
                    }
                    return {
                        state: "waiting_for_user",
                        convo_id,
                        question,
                        call_id: step.id,
                        tool_name: step.name,
                        history,
                    };
                }

                const tool = tools.get(step.name);
                let output: unknown;
                try {
                    if (!tool) throw new Error(`Unknown tool: ${step.name}`);
                    output = await tool.execute({ ...step.arguments });
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
                return { state: "completed", history, output: step };
            }
        }
    }
}
