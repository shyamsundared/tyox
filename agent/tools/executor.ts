import { posix } from "node:path";
import { z } from "zod";
import { PROJECT_ROOT } from "../config";
import type { ToolResult } from "../types";
import { errorMessage, timeLeft } from "../utils";
import { getProjectSandbox } from "../workspace/manager";
import { BASH_TOOL, READ_TOOL, WRITE_TOOL } from "./definitions";

const COMMAND_TIMEOUT_MS = 120_000;
// one long output (like listing node_modules) would otherwise use up the model's whole context
const MAX_BASH_OUTPUT = 10_000;

// the model decides these arguments, so they can't be trusted
const bashArgs = z.object({ commands: z.string().min(1) });
const readArgs = z.object({ path: z.string().min(1) });
const writeArgs = z.object({ path: z.string().min(1), content: z.string() });

// stops the model from reading or writing outside the project, like ../../etc/passwd
function safePath(filePath: string): string {
    const fullPath = posix.resolve(PROJECT_ROOT, filePath);
    const isAbsolute = filePath.includes("\\") || posix.isAbsolute(filePath);
    if (isAbsolute || !fullPath.startsWith(`${PROJECT_ROOT}/`)) {
        throw new Error("File paths must stay inside the project directory");
    }
    return fullPath;
}

async function runBash(args: unknown, projectId: string, deadline: number): Promise<ToolResult> {
    const { commands } = bashArgs.parse(args);

    // tyox runs these after the model finishes, running them twice just wastes the time limit
    if (/\b(?:npm|bun)\s+(?:run\s+)?(?:test|build)\b|\b(?:vitest|tsc)\b|\bvite\s+build\b/i.test(commands)) {
        return {
            success: false,
            output: "Tyox runs the test suite and production build after implementation. Do not repeat those checks; continue with the requested code changes.",
        };
    }

    const sandbox = await getProjectSandbox(projectId);
    const result = await sandbox.commands.run(commands, {
        cwd: PROJECT_ROOT,
        timeoutMs: timeLeft(deadline, COMMAND_TIMEOUT_MS),
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return { success: result.exitCode === 0, output: output.slice(-MAX_BASH_OUTPUT) };
}

async function readFile(args: unknown, projectId: string): Promise<ToolResult> {
    const { path } = readArgs.parse(args);
    const sandbox = await getProjectSandbox(projectId);
    return { success: true, output: await sandbox.files.read(safePath(path)) };
}

async function writeFile(args: unknown, projectId: string): Promise<ToolResult> {
    const { path, content } = writeArgs.parse(args);
    const sandbox = await getProjectSandbox(projectId);
    await sandbox.files.write(safePath(path), content);
    return { success: true, output: `Wrote ${path}` };
}

// tool errors go back to the model as a normal result so it can read the error and try again
export async function runTool(name: string, args: unknown, projectId: string, deadline: number): Promise<ToolResult> {
    try {
        if (name === BASH_TOOL.name) return await runBash(args, projectId, deadline);
        if (name === READ_TOOL.name) return await readFile(args, projectId);
        if (name === WRITE_TOOL.name) return await writeFile(args, projectId);
        return { success: false, output: `Unknown tool: ${name}` };
    } catch (error) {
        return { success: false, output: errorMessage(error) };
    }
}
