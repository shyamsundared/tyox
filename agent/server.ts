import { timingSafeEqual } from "node:crypto";
import express from "express";
import type { Response } from "express";
import { z } from "zod";
import { formatSseEvent } from "../shared/agent-events";
import type { AgentClientEvent } from "../shared/agent-events";
import { resumeAgent, startAgent } from "./agent-loop";
import { MODEL, RUN_TIMEOUT_MS } from "./config";
import { loadPendingRun } from "./pending-run";
import { errorMessage } from "./utils";
import { getProjectSandbox, installDependencies } from "./workspace/manager";
import { startProjectPreview } from "./workspace/preview";
import { saveProjectSnapshot } from "./workspace/storage";

const agentApiKey = process.env.AGENT_API_KEY ?? "local-development-agent-key";
if (process.env.NODE_ENV === "production" && (!process.env.AGENT_API_KEY || agentApiKey.length < 32)) {
    throw new Error("AGENT_API_KEY must be set to at least 32 characters in production");
}

const projectIdSchema = z.string().max(128).regex(/^[a-zA-Z0-9_-]+$/);
const promptSchema = z.object({
    project_id: projectIdSchema,
    conversation_id: z.string().min(1).max(128),
    message: z.string().trim().min(1).max(20_000),
});
const answerSchema = z.object({
    project_id: projectIdSchema,
    conversation_id: z.string().min(1).max(128),
    call_id: z.string().min(1).max(256),
    answer: z.string().trim().min(1).max(20_000),
});

// two runs on the same project would overwrite each other's files, so only allow one at a time.
// this lives in memory, so it only works while we run a single agent server
const runningProjects = new Set<string>();

function lockProject(projectId: string, res: Response): boolean {
    if (runningProjects.has(projectId)) {
        res.status(409).json({ error: "This project is already running a task." });
        return false;
    }
    runningProjects.add(projectId);
    return true;
}

async function streamRun(res: Response, run: (emit: (event: AgentClientEvent) => void) => Promise<void>) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const emit = (event: AgentClientEvent) => {
        if (!res.destroyed && !res.writableEnded) res.write(formatSseEvent(event));
    };

    try {
        await run(emit);
    } catch (error) {
        console.error("Agent run failed:", errorMessage(error));
        emit({ event: "error", data: { message: "The agent ran into a problem. Check the agent logs." } });
    } finally {
        res.end();
    }
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
    res.send("ok");
});

// only the backend should be able to call the agent
app.use("/api/v1/agent", (req, res, next) => {
    const expected = Buffer.from(agentApiKey);
    const provided = Buffer.from(req.header("x-agent-key") ?? "");
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        res.status(401).json({ error: "agent service authentication required" });
        return;
    }
    next();
});

app.post("/api/v1/agent/projects/:projectId/initialize", async (req, res) => {
    const parsed = projectIdSchema.safeParse(req.params.projectId);
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid project id" });
        return;
    }
    const projectId = parsed.data;
    if (!lockProject(projectId, res)) return;

    const deadline = Date.now() + RUN_TIMEOUT_MS;
    try {
        const sandbox = await getProjectSandbox(projectId);
        await installDependencies(sandbox, deadline);
        await saveProjectSnapshot(sandbox, projectId, deadline);
        const previewUrl = await startProjectPreview(projectId, () => {}, deadline);
        res.json({ previewUrl });
    } catch (error) {
        console.error(`Could not initialize project ${projectId}:`, errorMessage(error));
        res.status(500).json({ error: "Could not initialize the project workspace." });
    } finally {
        runningProjects.delete(projectId);
    }
});

app.post("/api/v1/agent/loop", async (req, res) => {
    const parsed = promptSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "A project, conversation and prompt of up to 20000 characters are required" });
        return;
    }
    const { project_id, conversation_id, message } = parsed.data;
    if (!lockProject(project_id, res)) return;

    try {
        await streamRun(res, (emit) => startAgent(message, conversation_id, project_id, emit));
    } finally {
        runningProjects.delete(project_id);
    }
});

app.post("/api/v1/agent/resume", async (req, res) => {
    const parsed = answerSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "A project, conversation, call id and answer of up to 20000 characters are required" });
        return;
    }
    const { project_id, conversation_id, call_id, answer } = parsed.data;
    if (!lockProject(project_id, res)) return;

    try {
        // read this after taking the lock so two answers can't both resume the same question
        const pending = await loadPendingRun(conversation_id);
        if (!pending || pending.project_id !== project_id || pending.call_id !== call_id) {
            res.status(409).json({ error: "No matching pending question for this project" });
            return;
        }
        await streamRun(res, (emit) => resumeAgent(pending, answer, conversation_id, emit));
    } catch (error) {
        console.error("Could not resume agent:", errorMessage(error));
        if (!res.headersSent) res.status(500).json({ error: "Could not resume the agent." });
    } finally {
        runningProjects.delete(project_id);
    }
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, "0.0.0.0", () => {
    console.log(`Agent listening on port ${port} (model: ${MODEL})`);
});
