export interface Toolcall{
  
        id: string,
        call_id: string,
        type: "function_call",
        name: string,
        arguments: string
    
}
export type Tooldef={
  type:"function"
    name:string,
    description:string,
    parameters:{
        type:"object",
        properties:Record<string,{
            type:"string",
            description:string
        }>,
        required:string[]

    },strict: boolean
};
export const bashTooldef:Tooldef={
  type:"function",
    name:"bash",
    description:"exectute bash commands ",
    parameters:{
        type:"object",
        properties:{
            command:{
                type:"string",
                description:"contains the bash command to execute"
        }
    },required:["command"]},strict:true
}
