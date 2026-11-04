import express from "express";
import { z } from "zod";
import { ProjectBusyError, withProjectRun } from "./project-runs";
import { main, resume, type AgentEventEmitter, type AgentRunEvent, type WaitingForUser } from "./agent-loop";
import { initializeProjectWorkspace } from "./workspace/manager";
import { startProjectPreview } from "./workspace/preview";
import { db } from "../db/db";
import { formatSseEvent } from "../shared/agent-events";
import { AGENT_RUN_TIMEOUT_MS } from "./deadline";
import { AGENT_MODEL } from "./agent-context";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { shutdownTelemetry, startTelemetry, tracingMiddleware, withSpan } from "./observability/telemetry";

const app = express();
app.use(tracingMiddleware);
app.use(express.json());

const agentApiKey = process.env.AGENT_API_KEY ?? "local-development-agent-key";
if (process.env.NODE_ENV === "production" && !process.env.AGENT_API_KEY) {
    throw new Error("AGENT_API_KEY must be configured in production");
}
if (process.env.NODE_ENV === "production" && Buffer.byteLength(agentApiKey) < 32) {
    throw new Error("AGENT_API_KEY must contain at least 32 bytes in production");
}

app.use("/api/v1/agent", (req, res, next) => {
    const providedKey = req.header("x-agent-key") ?? "";
    const expected = Buffer.from(agentApiKey);
    const provided = Buffer.from(providedKey);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        res.status(401).json({ error: "agent service authentication required" });
        return;
    }
    next();
});

app.post("/api/v1/agent/projects/:projectId/initialize", async (req, res) => {
    const deadlineAt = Date.now() + AGENT_RUN_TIMEOUT_MS;
    try {
        await withProjectRun(req.params.projectId, async () => {
            const result = await initializeProjectWorkspace(req.params.projectId, deadlineAt);
            const previewUrl = await startProjectPreview(req.params.projectId, async () => {}, deadlineAt);
            res.json({ initialized: true, packagesInstalled: result.installedPackages, previewUrl });
        });
    } catch (error) {
        if (error instanceof ProjectBusyError) {
            res.status(409).json({ error: error.message });
            return;
        }
        const errorReference = randomUUID();
        console.error(JSON.stringify({
            event: "project_workspace_initialization_failed",
            errorReference,
            projectId: req.params.projectId,
            error: error instanceof Error ? error.message : String(error),
        }));
        res.status(500).json({ error: `Could not initialize the project workspace. Check the agent service logs. Reference: ${errorReference}` });
    }
});

type PendingRun = Pick<WaitingForUser, "history" | "call_id" | "tool_name" | "project_id" | "question">;

async function savePendingRun(conversationId: string, pending: PendingRun | null) {
    await db.orm.public.ConversationHistory
        .where({ id: conversationId })
        .update({ agentState: pending ? JSON.stringify(pending) : null });
}

async function loadPendingRun(conversationId: string): Promise<PendingRun | null> {
    const conversation = await db.orm.public.ConversationHistory
        .where({ id: conversationId })
        .first();
    if (!conversation?.agentState) return null;

    try {
        const pending = JSON.parse(conversation.agentState) as Partial<PendingRun>;
        if (
            typeof pending.call_id !== "string" ||
            typeof pending.tool_name !== "string" ||
            typeof pending.project_id !== "string" ||
            typeof pending.question !== "string" ||
            !Array.isArray(pending.history)
        ) {
            throw new Error("Stored pending agent state is malformed");
        }
        return pending as PendingRun;
    } catch (error) {
        throw new Error(
            `Could not read pending agent state for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

function startSse(res: express.Response) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
}

async function emitAgentEvent(res: express.Response, event: AgentRunEvent) {
    if (event.event === "question") {
        await savePendingRun(event.data.conversation_id, event.pendingRun);
    }
    if (event.event === "complete") {
        await savePendingRun(event.conversationId, null);
    }
    if (!res.destroyed && !res.writableEnded) res.write(formatSseEvent(event));
}

async function streamAgentEvents(
    res: express.Response,
    run: (emit: AgentEventEmitter) => Promise<void>,
    context: { conversationId?: string; projectId?: string } = {},
) {
    const errorReference = randomUUID();
    startSse(res);
    const emit: AgentEventEmitter = (event) => emitAgentEvent(res, event);
    try {
        await withSpan("tyox.agent.run", {
            ...(context.conversationId ? { "conversation.id": context.conversationId } : {}),
            ...(context.projectId ? { "tyox.project.id": context.projectId } : {}),
        }, () => run(emit));
    } catch (error) {
        console.error(JSON.stringify({
            event: "agent_run_failed",
            errorReference,
            ...context,
            error: error instanceof Error ? error.message : String(error),
        }));
        await emit({
            event: "error",
            data: { message: `The agent ran into a problem. Check the agent service logs. Reference: ${errorReference}` },
        });
    } finally {
        if (!res.writableEnded) res.end();
    }
}

const projectIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
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

app.post("/api/v1/agent/loop", async (req, res) => {
    const result = promptSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: "A project, conversation, and prompt of 1–20,000 characters are required" });
        return;
    }
    const { conversation_id, message, project_id } = result.data;
    await withProjectRun(project_id, () => streamAgentEvents(
        res,
        (emit) => main(message, conversation_id, project_id, emit),
        { conversationId: conversation_id, projectId: project_id },
    ));
});

app.post("/api/v1/agent/resume", async (req, res) => {
    const result = answerSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: "A project, conversation, call ID, and answer of 1–20,000 characters are required" });
        return;
    }
    const { project_id, conversation_id, call_id, answer } = result.data;
    await withProjectRun(project_id, async () => {
        // Read after acquiring the guard so a simultaneous answer cannot reuse old state.
        const pending = await loadPendingRun(conversation_id);
        if (!pending || pending.project_id !== project_id || pending.call_id !== call_id) {
            res.status(409).json({ error: "No matching pending question for this project" });
            return;
        }
        await streamAgentEvents(res, (emit) => resume(
            pending.history,
            conversation_id,
            pending.call_id,
            pending.tool_name,
            project_id,
            answer,
            emit,
        ), { conversationId: conversation_id, projectId: project_id });
    });
});

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ProjectBusyError) {
        res.status(409).json({ error: error.message });
        return;
    }
    const errorReference = randomUUID();
    console.error(JSON.stringify({ event: "agent_request_failed", errorReference, error: error.message }));
    res.status(500).json({ error: `Agent request failed. Reference: ${errorReference}` });
});

app.get("/health", (_req, res) => res.status(200).send("ok"));

const port = Number(process.env.PORT ?? 3001);
startTelemetry();
app.listen(port, "0.0.0.0", () => {
    console.log(`Agent backend listening on port ${port} (model: ${AGENT_MODEL})`);
});

process.once("SIGTERM", () => {
    void shutdownTelemetry().finally(() => process.exit(0));
});
process.once("SIGINT", () => {
    void shutdownTelemetry().finally(() => process.exit(0));
});
