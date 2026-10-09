import { bash, createTodos, readfile, writefile } from "./functions";
import type { Tool } from "./types";
import { withDeadline } from "./deadline";

function deadline(args: Record<string, unknown>): number | undefined {
    return typeof args._deadlineAt === "number" ? args._deadlineAt : undefined;
}

function withinRun<T>(operation: Promise<T>, args: Record<string, unknown>): Promise<T> {
    const deadlineAt = deadline(args);
    return deadlineAt ? withDeadline(operation, deadlineAt) : operation;
}

export const readTool: Tool = {
    name: "Read_File",
    execute: (args) => withinRun(readfile(args.path as string, args.project_id as string), args),
};

export const bashTool: Tool = {
    name: "Bash_Tool",
    execute: (args) => withinRun(bash(args.commands as string, args.project_id as string, deadline(args)), args),
};

export const writeTool: Tool = {
    name: "Write_File",
    execute: (args) => withinRun(writefile(args.path as string, args.content as string, args.project_id as string), args),
};

export const createTodosTool: Tool = {
    name: "Create_Todos",
    execute: async (args) => withinRun((async () => {
        if (typeof args.project_id !== "string") {
            return { success: false, output: "A project ID is required to save tasks." };
        }
        return createTodos(args.project_id, args.tasks);
    })(), args),
};
