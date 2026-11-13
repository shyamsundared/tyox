import type { client } from "./config";

type InteractionResponse = Awaited<ReturnType<typeof client.interactions.create>>;

// pull the step type out of the gemini sdk so history stays type safe
export type Step = Extract<InteractionResponse, { steps: unknown }>["steps"][number];
export type FunctionResultStep = Extract<Step, { type: "function_result" }>;

export type ToolDefinition = {
    type: "function";
    name: string;
    description: string;
    parameters: object;
};

export type ToolResult = {
    success: boolean;
    output: string;
};

// what we store in the db while the agent waits for the user to answer a question
export type PendingRun = {
    question: string;
    call_id: string;
    tool_name: string;
    project_id: string;
    history: Step[];
};
