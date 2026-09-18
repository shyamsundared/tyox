import { GoogleGenAI } from "@google/genai";
import { bashtool, readtool, writetool } from "./tooldefinition";

import { exec } from "child_process";
import type{UserInputStep,FunctionCallStep,FunctionResultStep,endcall} from"./types"
import {client,history} from "./types"
import { bash,readfile } from "./functions";
import type {Tool,ToolResult} from "./types"
import { bash_t,read_t, write_t} from "./toolabs";
import { hostname } from "os";
const MAIN_PROMPT="your are a software developer."
let mp =new Map<string,Tool>();
mp.set(bashtool.name,bash_t);
mp.set(readtool.name,read_t);
mp.set(writetool.name,write_t);
async function main() {

    // Add the initial user message to history
    const userStep: UserInputStep = {
        type: "user_input",
        content: [{text:"read the questions from qns.md file and write answer inside that file",type:"text"}]
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
                const result=await tool.execute(step.arguments);
                        const resultStep: FunctionResultStep = {
                            type: "function_result",
                            name: step.name,
                            call_id: step.id,

                            result: {
                                output: result
                            }
                        };


                        history.push(resultStep);

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
                       // history.push(resultStep);
                       // console.error("Tool failed", message);

                    }
                }
            


            // If Gemini produced its final answer,
            // we're done.
            if (step.type==="model_output") {

                console.log("\nGemini:", step.content);

                return;
            }
        }
        }
}


main();