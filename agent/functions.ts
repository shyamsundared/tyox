
import {exec }from "child_process"
import { error } from "console";
import { writeFile,readFile } from "fs/promises";
import { output, success } from "zod";
import type { ToolResult } from "./types";
export function bash(commands: string): Promise<ToolResult> {

    return new Promise((resolve, reject) => {

        exec(commands, (error, stdout, stderr) => {

            if (error) {
                reject(error);
                return{success:false};
            }

            if (stderr) {
                reject(new Error(stderr));
                return{success:false};
            }

            resolve({success:true,output:stdout});
        });

    });
}


export async function readfile(path:string):Promise<ToolResult>{
   /* */
    try {
        const data=await readFile(path,'utf-8');
        return {
            success:true,
            output:data
        }
    } catch (error) {
        return {success:false,
            output:`cannot read file ${path}`
        }
    }
   

}
export async function writefile(path:string):Promise<ToolResult>{
   /* */
    try {
        const data=await writeFile(path,'utf-8');
        return {
            success:true,
           
        }
    } catch (error) {
        return {success:false,
            output:`cannot write into file ${path}`
        }
    }
   

}
type AgentEvent={
    type:"question",
    Conversation_history_id:string,
    question:string
}
type Qna_result={
    status:"qn asked"
}
export function qna_fn(question:string,Conversation_history_id:string,emit:(event:AgentEvent)=>void):Qna_result{
  
    return {
    status:"qn asked"}


}
