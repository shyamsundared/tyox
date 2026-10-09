import { posix } from "node:path";
import { db } from "../db/db";
import { clearProjectSandboxCache, getProjectSandbox, PROJECT_ROOT } from "./workspace";
import type { ToolResult } from "./types";

function projectFile(projectId: string, filePath: string): string {
    if (!filePath.trim()) throw new Error("A file path is required");
    if (filePath.includes("\\") || posix.isAbsolute(filePath)) {
        throw new Error("File paths must stay inside the project directory");
    }
    const destination = posix.resolve(PROJECT_ROOT, filePath);
    if (destination !== PROJECT_ROOT && !destination.startsWith(`${PROJECT_ROOT}/`)) {
        throw new Error("File paths must stay inside the project directory");
    }
    return destination;
}

export async function bash(commands: string, projectId: string): Promise<ToolResult> {
    try {
        const sandbox = await getProjectSandbox(projectId);
        const result = await sandbox.commands.run(commands, {
            cwd: PROJECT_ROOT,
            timeoutMs: 120_000,
        });
        const output = [result.stdout, result.stderr, result.error].filter(Boolean).join("\n").trim()
            || (result.exitCode === 0 ? "" : `Command exited with status ${result.exitCode}`);
        return { success: result.exitCode === 0, output };
    } catch (error) {
        clearProjectSandboxCache(projectId);
        return { success: false, output: error instanceof Error ? error.message : String(error) };
    }
}

export async function readfile(filePath: string, projectId: string): Promise<ToolResult> {
    try {
        const path = projectFile(projectId, filePath);
        const sandbox = await getProjectSandbox(projectId);
        const data = await sandbox.files.read(path);
        return { success: true, output: data };
    } catch (error) {
        clearProjectSandboxCache(projectId);
        return { success: false, output: error instanceof Error ? error.message : String(error) };
    }
}

export async function writefile(filePath: string, content: string, projectId: string): Promise<ToolResult> {
    try {
        const path = projectFile(projectId, filePath);
        const sandbox = await getProjectSandbox(projectId);
        await sandbox.files.write(path, content);
        return { success: true, output: `Wrote ${filePath}` };
    } catch (error) {
        clearProjectSandboxCache(projectId);
        return { success: false, output: error instanceof Error ? error.message : String(error) };
    }
}

type TodoInput = { title: string; description?: string };

export async function createTodos(projectId: string, rawTasks: unknown): Promise<ToolResult> {
    if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
        return { success: false, output: "At least one task is required." };
    }

    const tasks: TodoInput[] = [];
    for (const [index, item] of rawTasks.entries()) {
        if (!item || typeof item !== "object") {
            return { success: false, output: `Task ${index + 1} must be an object.` };
        }
        const record = item as Record<string, unknown>;
        if (typeof record.title !== "string" || !record.title.trim()) {
            return { success: false, output: `Task ${index + 1} needs a title.` };
        }
        if (record.description !== undefined && typeof record.description !== "string") {
            return { success: false, output: `Task ${index + 1} has an invalid description.` };
        }
        tasks.push({
            title: record.title.trim(),
            ...(typeof record.description === "string" && record.description.trim()
                ? { description: record.description.trim() }
                : {}),
        });
    }

    const project = await db.orm.public.Project.where({ id: projectId }).first();
    if (!project) return { success: false, output: "The project does not exist." };

    const created = [];
    for (const [position, task] of tasks.entries()) {
        created.push(await db.orm.public.Todo.create({
            projectId,
            title: task.title,
            description: task.description ?? null,
            position,
        }));
    }
    return {
        success: true,
        output: JSON.stringify(created.map(({ id, title, description, position }) => ({ id, title, description, position }))),
    };
}
