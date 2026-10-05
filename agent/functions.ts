import { exec } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { db } from "../db/db";
import type { ToolResult } from "./types";

const projectsRoot = resolve(process.env.TYOX_PROJECTS_DIR ?? resolve(import.meta.dir, "../backend/projects"));

function projectDirectory(projectId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error("Invalid project ID");
    return resolve(projectsRoot, projectId);
}

function projectFile(projectId: string, filePath: string): string {
    if (!filePath.trim()) throw new Error("A file path is required");
    const root = projectDirectory(projectId);
    const destination = resolve(root, filePath);
    const pathFromRoot = relative(root, destination);
    if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
        throw new Error("File paths must stay inside the project directory");
    }
    return destination;
}

export async function bash(commands: string, projectId: string): Promise<ToolResult> {
    const cwd = projectDirectory(projectId);
    await mkdir(cwd, { recursive: true });
    return new Promise((resolveResult) => {
        exec(commands, { cwd, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
            const output = [stdout, stderr].filter(Boolean).join("\n").trim();
            resolveResult({
                success: !error,
                output: error ? `${output}${output ? "\n" : ""}${error.message}` : output,
            });
        });
    });
}

export async function readfile(filePath: string, projectId: string): Promise<ToolResult> {
    try {
        const data = await readFile(projectFile(projectId, filePath), "utf8");
        return { success: true, output: data };
    } catch (error) {
        return { success: false, output: error instanceof Error ? error.message : String(error) };
    }
}

export async function writefile(filePath: string, content: string, projectId: string): Promise<ToolResult> {
    try {
        const path = projectFile(projectId, filePath);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, "utf8");
        return { success: true, output: `Wrote ${filePath}` };
    } catch (error) {
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
