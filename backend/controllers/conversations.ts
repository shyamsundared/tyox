import type { Readable } from "node:stream";
import axios from "axios";
import type express from "express";
import { db } from "../../db/db";
import { formatSseEvent, type AgentClientEvent } from "../../shared/agent-events";

function startSse(res: express.Response) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
}

function writeSseError(res: express.Response, error: unknown) {
    if (res.destroyed) return;
    if (!res.headersSent) startSse(res);
    const message = error instanceof Error ? error.message : String(error);
    res.write(formatSseEvent({ event: "error", data: { message } }));
    res.end();
}

function relayAgentStream(stream: Readable, res: express.Response, conversationId: string) {
    let buffer = "";
    let pendingWrites = Promise.resolve();

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
            }).then(() => undefined));
        } catch (error) {
            pendingWrites = pendingWrites.then(() => Promise.reject(error));
        }
    };

    stream.on("data", (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) saveMessage(block);
    });
    stream.on("error", (error: unknown) => writeSseError(res, error));
    stream.on("end", async () => {
        if (buffer.trim()) saveMessage(buffer);
        try {
            await pendingWrites;
            if (!res.writableEnded) res.end();
        } catch (error) {
            writeSseError(res, error);
        }
    });
    stream.pipe(res, { end: false });
}

export async function getConversationHistory(req: express.Request<{ projectid: string }>, res: express.Response) {
    try {
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

export async function sendMessage(req: express.Request<{ projectid: string }>, res: express.Response) {
    const { projectid } = req.params;
    const { message } = req.body;
    if (typeof message !== "string" || !message.trim()) {
        res.status(400).json({ error: "message is required" });
        return;
    }

    try {
        const project = await db.orm.public.Project.where({ id: projectid }).first();
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
        const agentResponse = await axios.post(
            "http://localhost:3001/api/v1/agent/loop",
            { conversation_id: conversation.id, message, project_id: projectid },
            { responseType: "stream" },
        );
        relayAgentStream(agentResponse.data, res, conversation.id);
    } catch (error) {
        writeSseError(res, error);
    }
}

export async function answerQuestion(req: express.Request<{ projectid: string }>, res: express.Response) {
    const { projectid } = req.params;
    const { conversation_id, call_id, answer } = req.body as {
        conversation_id?: string;
        call_id?: string;
        answer?: string;
    };
    if (!conversation_id || !call_id || typeof answer !== "string" || !answer.trim()) {
        res.status(400).json({ error: "conversation_id, call_id, and answer are required" });
        return;
    }

    try {
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
        const agentResponse = await axios.post(
            "http://localhost:3001/api/v1/agent/resume",
            { conversation_id, call_id, answer },
            { responseType: "stream" },
        );
        relayAgentStream(agentResponse.data, res, conversation_id);
    } catch (error) {
        writeSseError(res, error);
    }
}
