import { GoogleGenAI } from "@google/genai";
import { bashtool, qnatool, readtool, writetool } from "./tooldefinition";

import { exec } from "child_process";
import type{UserInputStep,FunctionCallStep,FunctionResultStep,endcall} from"./types"
import {client,history} from "./types"
import { bash,qna_fn,readfile } from "./functions";
import type {Tool,ToolResult} from "./types"
import { bash_t,read_t, write_t} from "./toolabs";
import { hostname } from "os";

let mp =new Map<string,Tool>();
mp.set(bashtool.name,bash_t);
mp.set(readtool.name,read_t);
mp.set(writetool.name,write_t);
mp.set(qnatool.name,qna_fn)
export async function main(input:string,ctx:string[],convo_id:string) {

    // Add the initial user message to history
   
    for(const x of ctx){
         const userStep: UserInputStep = {
        type: "user_input",
        content: [{text:x,type:"text"}]
    };
        history.push(userStep)
    }
     const userStep: UserInputStep = {
        type: "user_input",
        content: [{text:input,type:"text"}]
    };

    history.push(userStep);


    while (true) {
        const response = await client.interactions.create({
            model: "gemini-3.5-flash-lite",
            input: history,
            tools: [bashtool,readtool,writetool],
        });
        for (const step of response.steps) {
            console.log("Gemini step:", step);
            history.push(step);
            if (step.type === "function_call") {
                    try {
                        const tool=mp.get(step.name);
                if(!tool){
                    throw new Error(`unknown tool , not found,${step.name}`);
                }
                console.log(step.arguments);
                const result=await tool.execute({...step.arguments});
                        const resultStep: FunctionResultStep = {
                            type: "function_result",
                            name: step.name,
                            call_id: step.id,

                            result: {
                                output: result
                            }
                        };


                        history.push(resultStep);
                        if(tool.name==="qna"){

                            return JSON.stringify({"qn asked",convo_id,result});
                        }

                    } catch (error) {

                        const message =
                            error instanceof Error
                                ? error.message
                                : String(error);
                        const resultStep: FunctionResultStep = {
                            type: "function_result",
                            name: step.name,
                            call_id: step.id,

                            result: {
                                output: message
                            }
                        };
                        history.push(resultStep);
                        console.error("Tool failed", message);

                    }
                }
            


            // If Gemini produced its final answer,
            // we're done.
            if (step.type==="model_output") {
                return;
            }
        }
        }
}


