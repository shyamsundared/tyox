import { Type } from "@google/genai";
import { properties } from "zod";
import {z } from "zod"
import type { Tooldef } from "./types";
export const bashtool:Tooldef = {
    type: "function",
    name: "Bash_tool",
    description: "execute the commands in the commands property",
    parameters: {
        type: Type.OBJECT,
        properties: {
            commands: { type: Type.STRING, description: "bash commands" },
        },
        required: ["commands"],
    },
} as const;

export const readtool:Tooldef={
    type:"function",
    name:"Read_File",
    description:"read the contents of the file from the path in the input",
    parameters:{
        type:Type.OBJECT,
        properties:{
            path:{type:Type.STRING,description:"input path"},
        },
        required:["path"],
    },
    
} as const;
export const writetool:Tooldef={
    type:"function",
    name:"Write_File",
    description:"write contents into the file",
    parameters:{
        type:Type.OBJECT,
        properties:{
            path:{type:Type.STRING,description:"path"},
        },
        required:["path"],
    },
    
} as const;