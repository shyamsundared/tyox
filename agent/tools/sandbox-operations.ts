import { posix } from "node:path";
import { getProjectSandbox, PROJECT_ROOT } from "../workspace/manager";
import type { ToolResult } from "../agent-types";
import { remainingTimeout, withDeadline } from "../deadline";

function projectFile(filePath: string): string {
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

export async function bash(commands: string, projectId: string, deadlineAt?: number): Promise<ToolResult> {
    if (/\b(?:npm|bun)\s+(?:run\s+)?(?:test|build)\b|\b(?:vitest|tsc)\b|\bvite\s+build\b/i.test(commands)) {
        return {
            success: false,
            output: "Tyox runs the test suite and production build after implementation. Do not repeat those checks; continue with the requested code changes.",
        };
    }

    try {
        const sandboxRequest = getProjectSandbox(projectId);
        const sandbox = deadlineAt ? await withDeadline(sandboxRequest, deadlineAt) : await sandboxRequest;
        const timeoutMs = deadlineAt ? remainingTimeout(deadlineAt, 120_000) : 120_000;
        const command = sandbox.commands.run(commands, {
            cwd: PROJECT_ROOT,
            timeoutMs,
        });
        const result = deadlineAt ? await withDeadline(command, deadlineAt) : await command;
        const output = [result.stdout, result.stderr, result.error].filter(Boolean).join("\n").trim()
            || (result.exitCode === 0 ? "" : `Command exited with status ${result.exitCode}`);
        return { success: result.exitCode === 0, output };
    } catch (error) {
        return { success: false, output: error instanceof Error ? error.message : String(error) };
    }
}

export async function readfile(filePath: string, projectId: string): Promise<ToolResult> {
    try {
        const path = projectFile(filePath);
        const sandbox = await getProjectSandbox(projectId);
        const data = await sandbox.files.read(path);
        return { success: true, output: data };
    } catch (error) {
        return { success: false, output: error instanceof Error ? error.message : String(error) };
    }
}

export async function writefile(filePath: string, content: string, projectId: string): Promise<ToolResult> {
    if (/^\s*\[Previous file contents omitted to fit the context budget\.\]\s*$/.test(content)) {
        return {
            success: false,
            output: "This is a context-compaction placeholder, not source code. Read the current file and retry with the complete file contents.",
        };
    }

    try {
        const path = projectFile(filePath);
        const sandbox = await getProjectSandbox(projectId);
        await sandbox.files.write(path, content);
        return { success: true, output: `Wrote ${filePath}` };
    } catch (error) {
        return { success: false, output: error instanceof Error ? error.message : String(error) };
    }
}
