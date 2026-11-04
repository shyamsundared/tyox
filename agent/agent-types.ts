import type { client } from "./config";

export type InteractionResponse = Awaited<
    ReturnType<typeof client.interactions.create>
>;
export type NonStreamingResponse = Extract<
    InteractionResponse,
    { steps: unknown }
>;

export type Step = NonStreamingResponse["steps"][number];

export type UserInputStep = Extract<
    Step,
    { type: "user_input" }
>;

export type FunctionResultStep = Extract<
    Step,
    { type: "function_result" }
>;

export type Tooldef = {
    type: "function";
    name: string;
    description: string;
    parameters: object;
};

export type Tool = {
    name: string;
    execute: (args: Record<string, unknown>) => Promise<ToolResult>;
};

export type ToolResult = {
    success: boolean;
    output: string;
}

