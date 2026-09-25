import { bash, readfile, writefile } from "./functions";
import type { Tool,Tooldef,ToolResult } from "./types";
export const read_t:Tool={
    name:"Read_File",
    execute:async (args)=>{
        const arg=JSON.stringify(args);
        return readfile(args.path as string)}
} 
export const bash_t:Tool={
    name:"Bash_Tool",
    execute:async (args)=>{
        const arg=JSON.stringify(args);
        return bash(args.commands as string)}
}
export const write_t:Tool={
    name:"Write_File",
    execute:async (args)=>{
        const arg=JSON.stringify(args);
        return writefile(args.commands as string)}
}
export const qna_fn:Tool={
    name:"qna_tool",
    execute:async (args,emit:)=>{
        const arg=JSON.stringify(args);
        return writefile(args.commands as string)}
}