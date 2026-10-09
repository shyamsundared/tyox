import { Type } from "@google/genai";
import type { Tooldef } from "./types";

export const bashToolDefinition: Tooldef = {
    type: "function",
    name: "Bash_Tool",
    description: "Run a shell command in the current Vite + React + TypeScript project directory. Use this for inspecting files or other focused project tasks; do not replace the project with a standalone HTML page. Do not run the test suite or production build; Tyox runs both once after implementation.",
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
    description: "Read a file from the current Vite + React + TypeScript project. The app UI is normally in src/App.tsx and its styles are in src/index.css.",
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
    description: "Write a project file. This workspace is already a Vite + React + TypeScript app: put page UI in src/App.tsx and styles in src/index.css. For each user request, derive a few user-visible acceptance criteria and create or update focused tests for them in src before or alongside the implementation. Use React Testing Library queries and user interactions, preserve existing useful tests, and never weaken or delete a test just to make it pass. Keep package.json, index.html, and src/main.tsx as the app setup unless the user explicitly asks to change the setup.",
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
