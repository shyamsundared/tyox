import { Type } from "@google/genai";
import type { Tooldef } from "./types";

export const bashToolDefinition: Tooldef = {
    type: "function",
    name: "Bash_Tool",
    description: "Run a shell command in the current project directory.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            commands: { type: Type.STRING, description: "The shell command to run." },
        },
        required: ["commands"],
    },
};

export const readToolDefinition: Tooldef = {
    type: "function",
    name: "Read_File",
    description: "Read a file from the current project.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            path: { type: Type.STRING, description: "Path to the file." },
        },
        required: ["path"],
    },
};

export const writeToolDefinition: Tooldef = {
    type: "function",
    name: "Write_File",
    description: "Write the supplied content to a file in the current project.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            path: { type: Type.STRING, description: "Path to the file." },
            content: { type: Type.STRING, description: "Complete file content." },
        },
        required: ["path", "content"],
    },
};

export const questionToolDefinition: Tooldef = {
    type: "function",
    name: "Qna",
    description: "Ask the user a clarifying question before continuing.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            question: { type: Type.STRING, description: "The question to ask." },
        },
        required: ["question"],
    },
};

export const createTodosToolDefinition: Tooldef = {
    type: "function",
    name: "Create_Todos",
    description: "Save an ordered task plan for the current project.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            tasks: {
                type: Type.ARRAY,
                description: "The ordered tasks in the plan.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: "Short task title." },
                        description: { type: Type.STRING, description: "Optional task details." },
                    },
                    required: ["title"],
                },
            },
        },
        required: ["tasks"],
    },
};
