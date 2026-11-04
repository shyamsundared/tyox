import { bash, readfile, writefile } from "./sandbox-operations";
import type { Tool } from "../agent-types";
import { z } from "zod";

const fileArgs = z.object({ path: z.string().min(1), project_id: z.string().min(1) });
const writeArgs = fileArgs.extend({ content: z.string() });
const commandArgs = z.object({
    commands: z.string().min(1),
    project_id: z.string().min(1),
    _deadlineAt: z.number().optional(),
});

export const readTool: Tool = {
    name: "Read_File",
    execute: (args) => {
        const { path, project_id } = fileArgs.parse(args);
        return readfile(path, project_id);
    },
};

export const bashTool: Tool = {
    name: "Bash_Tool",
    execute: (args) => {
        const { commands, project_id, _deadlineAt } = commandArgs.parse(args);
        return bash(commands, project_id, _deadlineAt);
    },
};

export const writeTool: Tool = {
    name: "Write_File",
    execute: (args) => {
        const { path, content, project_id } = writeArgs.parse(args);
        return writefile(path, content, project_id);
    },
};
