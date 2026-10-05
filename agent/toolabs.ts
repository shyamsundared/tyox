import { bash, createTodos, readfile, writefile } from "./functions";
import type { Tool } from "./types";

export const readTool: Tool = {
    name: "Read_File",
    execute: (args) => readfile(args.path as string, args.project_id as string),
};

export const bashTool: Tool = {
    name: "Bash_Tool",
    execute: (args) => bash(args.commands as string, args.project_id as string),
};

export const writeTool: Tool = {
    name: "Write_File",
    execute: (args) => writefile(args.path as string, args.content as string, args.project_id as string),
};

export const createTodosTool: Tool = {
    name: "Create_Todos",
    execute: async (args) => {
        if (typeof args.project_id !== "string") {
            return { success: false, output: "A project ID is required to save tasks." };
        }
        return createTodos(args.project_id, args.tasks);
    },
};
