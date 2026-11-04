import type { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import axios from "axios";
import type express from "express";
import { db } from "../../db/db";
import type { Response } from "express";
import { formatSseEvent, type AgentClientEvent } from "../../shared/agent-events";
import { injectTraceHeaders, markCurrentSpanError, withSpan } from "../telemetry";

const agentOrigin = process.env.AGENT_ORIGIN ?? "http://localhost:3001";
const agentApiKey = process.env.AGENT_API_KEY ?? "local-development-agent-key";

function startSse(res: express.Response) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
}

function writeSseError(res: express.Response, error: unknown, conversationId?: string) {
    markCurrentSpanError(error);
    if (res.destroyed || res.writableEnded) return;
    if (!res.headersSent) startSse(res);
    const errorReference = randomUUID();
    console.error(JSON.stringify({
        event: "agent_stream_relay_failed",
        errorReference,
        conversationId,
        error: error instanceof Error ? error.message : String(error),
    }));
    res.write(formatSseEvent({
        event: "error",
        data: { message: axios.isAxiosError(error) && error.response?.status === 409
            ? "The project is busy or this question has already been answered. Wait for the current task, then reload its history."
            : `The request was interrupted by a server error. Check the backend service logs. Reference: ${errorReference}` },
    }));
    res.end();
}

function relayAgentStream(stream: Readable, res:Response, conversationId: string) {
    let buffer = "";
    let pendingWrites = Promise.resolve();
    let persistenceError: unknown;
    stream.setEncoding("utf8");

    const saveMessage = (block: string) => {
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of block.split(/\r?\n/)) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (!dataLines.length || !["question", "complete"].includes(eventName)) return;

        try {
            const event = {
                event: eventName,
                data: JSON.parse(dataLines.join("\n")),
            } as AgentClientEvent;
            const content = event.event === "question"
                ? event.data.question
                : event.event === "complete" ? event.data.message : "";
            if (!content.trim()) return;

            pendingWrites = pendingWrites.then(() => db.orm.public.Conversation.create({
                conversation_id: conversationId,
                Content: content,
                From: "ASSISTANT",
                ConversationType: "TEXT_MESSAGE",
                toolcall: event.event === "question" ? "QNA" : null,
            }).then(() => undefined)).catch((error: unknown) => {
                persistenceError = error;
            });
        } catch (error) {
            persistenceError = error;
        }
    };

    stream.on("data", (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) saveMessage(block);
    });
    stream.on("error", (error: unknown) => writeSseError(res, error, conversationId));
    stream.on("end", async () => {
        if (buffer.trim()) saveMessage(buffer);
        try {
            await pendingWrites;
            if (persistenceError) throw persistenceError;
            if (!res.writableEnded) res.end();
        } catch (error) {
            writeSseError(res, error, conversationId);
        }
    });
    stream.pipe(res, { end: false });
}

export async function getConversationHistory(req: express.Request<{ projectid: string }>, res: express.Response) {
    try {
        const project = await db.orm.public.Project.where({ id: req.params.projectid, userid: req.userId }).first();
        if (!project) {
            res.status(404).json({ error: "project not found" });
            return;
        }
        const histories = await db.orm.public.ConversationHistory
            .where({ projectId: req.params.projectid })
            .include("convos", (convos) => convos.orderBy((conversation) => conversation.createdAt.asc()))
            .orderBy((history) => history.createdAt.asc())
            .all();
        res.json(histories.map(({ agentState, ...history }) => {
            let pendingQuestion = null;
            if (agentState) {
                try {
                    const state = JSON.parse(agentState) as { call_id?: unknown; question?: unknown };
                    if (typeof state.call_id === "string" && typeof state.question === "string") {
                        pendingQuestion = {
                            conversation_id: history.id,
                            call_id: state.call_id,
                            question: state.question,
                        };
                    }
                } catch {
                    // Invalid persisted agent state should not prevent the project history from loading.
                }
            }
            return { ...history, pendingQuestion };
        }));
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
}

export async function sendMessage(req: express.Request<{ projectid: string }>,res:Response) {
    const { projectid } = req.params;
    const { message } = req.body ?? {};
    if (typeof message !== "string" || !message.trim() || message.length > 20_000) {
        res.status(400).json({ error: "message must contain 1–20,000 characters" });
        return;
    }

    try {
        const project = await db.orm.public.Project.where({ id: projectid, userid: req.userId }).first();
        if (!project) {
            res.status(404).json({ error: "project not found" });
            return;
        }
        const conversation = await db.orm.public.ConversationHistory.create({ projectId: projectid });
        await db.orm.public.Conversation.create({
            conversation_id: conversation.id,
            Content: message,
            From: "USER",
            ConversationType: "TEXT_MESSAGE",
        });


        startSse(res);
        const agentResponse = await withSpan("tyox.agent.request", {
            "http.request.method": "POST",
            "server.address": new URL(agentOrigin).host,
            "tyox.agent.operation": "loop",
        }, async () => {
            const headers: Record<string, string> = { "x-agent-key": agentApiKey };
            injectTraceHeaders(headers);
            return axios.post(
                `${agentOrigin}/api/v1/agent/loop`,
                { conversation_id: conversation.id, message, project_id: projectid },
                { responseType: "stream", headers, timeout: 330_000 },
            );
        });
        relayAgentStream(agentResponse.data, res, conversation.id);
    } catch (error) {
        writeSseError(res, error);
    }
}

export async function answerQuestion(req: express.Request<{ projectid: string }>, res: express.Response) {
    const { projectid } = req.params;
    const { conversation_id, call_id, answer } = (req.body ?? {}) as {
        conversation_id?: string;
        call_id?: string;
        answer?: string;
    };
    if (!conversation_id || !call_id || typeof answer !== "string" || !answer.trim() || answer.length > 20_000) {
        res.status(400).json({ error: "conversation_id, call_id, and answer are required" });
        return;
    }

    try {
        const project = await db.orm.public.Project.where({ id: projectid, userid: req.userId }).first();
        if (!project) {
            res.status(404).json({ error: "project not found" });
            return;
        }
        const conversation = await db.orm.public.ConversationHistory
            .where({ id: conversation_id, projectId: projectid })
            .first();
        if (!conversation) {
            res.status(404).json({ error: "conversation not found for this project" });
            return;
        }
        await db.orm.public.Conversation.create({
            conversation_id,
            Content: answer,
            From: "USER",
            ConversationType: "TEXT_MESSAGE",
        });

        startSse(res);
        const agentResponse = await withSpan("tyox.agent.request", {
            "http.request.method": "POST",
            "server.address": new URL(agentOrigin).host,
            "tyox.agent.operation": "resume",
        }, async () => {
            const headers: Record<string, string> = { "x-agent-key": agentApiKey };
            injectTraceHeaders(headers);
            return axios.post(
                `${agentOrigin}/api/v1/agent/resume`,
                { project_id: projectid, conversation_id, call_id, answer },
                { responseType: "stream", headers, timeout: 330_000 },
            );
        });
        relayAgentStream(agentResponse.data, res, conversation_id);
    } catch (error) {
        writeSseError(res, error);
    }
}
