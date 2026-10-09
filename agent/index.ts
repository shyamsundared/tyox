import express from "express";
import { main, resume, type AgentEventEmitter, type AgentRunEvent, type WaitingForUser } from "./output";
import { initializeProjectWorkspace } from "./workspace";
import { startProjectPreview } from "./preview";
import { db } from "../db/db";
import { formatSseEvent } from "../shared/agent-events";

const app = express();
app.use(express.json());

app.post("/api/v1/agent/projects/:projectId/initialize", async (req, res) => {
    try {
        const result = await initializeProjectWorkspace(req.params.projectId);
        const previewUrl = await startProjectPreview(req.params.projectId, async () => {});
        res.json({ initialized: true, packagesInstalled: result.installedPackages, previewUrl });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

type PendingRun = Pick<WaitingForUser, "history" | "call_id" | "tool_name" | "project_id" | "question">;
const resumingConversations = new Set<string>();

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
) {
    startSse(res);
    const emit: AgentEventEmitter = (event) => emitAgentEvent(res, event);
    try {
        await run(emit);
    } catch (error) {
        await emit({
            event: "error",
            data: { message: error instanceof Error ? error.message : String(error) },
        });
    } finally {
        if (!res.writableEnded) res.end();
    }
}

app.post("/api/v1/agent/loop", async (req, res) => {
    const { conversation_id, message, project_id } = req.body 
    await streamAgentEvents(res, (emit) => main(message, [], conversation_id, project_id, emit));
});

app.post("/api/v1/agent/resume", async (req, res) => {
    const { conversation_id, call_id, answer } = req.body as {
        conversation_id?: string;
        call_id?: string;
        answer?: string;
    };
    if (!conversation_id || !call_id || typeof answer !== "string") {
        res.status(400).json({ error: "conversation_id, call_id, and answer are required" });
        return;
    }

    if (resumingConversations.has(conversation_id)) {
        res.status(409).json({ error: "A response is already being processed for this conversation" });
        return;
    }

    let pending: PendingRun | null;
    try {
        pending = await loadPendingRun(conversation_id);
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
        return;
    }
    if (!pending || pending.call_id !== call_id) {
        res.status(409).json({ error: "No matching pending question for this conversation" });
        return;
    }

    const pendingRun = pending;
    resumingConversations.add(conversation_id);
    try {
        await streamAgentEvents(res, (emit) => resume(
            pendingRun.history,
            conversation_id,
            pendingRun.call_id,
            pendingRun.tool_name,
            pendingRun.project_id,
            answer,
            emit,
        ));
    } finally {
        resumingConversations.delete(conversation_id);
    }
});

app.listen(3001, () => {
    console.log("Agent backend listening on http://localhost:3001");
});
