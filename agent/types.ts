import { GoogleGenAI } from "@google/genai";
import type { output } from "zod";

export const gemini_key = process.env.GEMINI_API_KEY;

export const client = new GoogleGenAI({
    apiKey: gemini_key
});


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

export type FunctionCallStep = Extract<
    Step,
    { type: "function_call" }
>;

export type FunctionResultStep = Extract<
    Step,
    { type: "function_result" }
>;
export type endcall=Extract<Step,{type:"model_output"}>
export type Tooldef={
    type:"function",
    name:string,
    description:string,
    parameters:object,

}
export type AgentEvent={
    type:"question",
    Conversation_history_id:string,
    question:string
}
export let history: Step[] = [];
export type Tool={name:string,execute:(args:Record<string,unknown>,emit?:(event:AgentEvent)=>void )=>Promise<any>}
export type ToolResult={
    success:boolean,
    output?:string,
}