import axios from "axios";
import type { Readable } from "node:stream";
import type { Request, Response } from "express";
import { db } from "../../db/db";
import { formatSseEvent, parseSseEvent } from "../../shared/agent-events";
import { streamFromAgent } from "../agent-client";
import { answerSchema, messageSchema } from "../schemas";

function findUserProject(projectId: string, userId: string | undefined) {
    return db.orm.public.Project.where({ id: projectId, userid: userId }).first();
}

function saveUserMessage(conversationId: string, content: string) {
    return db.orm.public.Conversation.create({
        conversation_id: conversationId,
        Content: content,
        From: "USER",
        ConversationType: "TEXT_MESSAGE",
    });
}

function startSse(res: Response) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
}

function sendSseError(res: Response, error: unknown) {
    console.error("Agent stream failed:", error instanceof Error ? error.message : error);
    if (res.destroyed || res.writableEnded) return;

    const isBusy = axios.isAxiosError(error) && error.response?.status === 409;
    const message = isBusy
        ? "The project is busy or this question has already been answered. Wait for the current task, then reload."
        : "The request was interrupted by a server error.";
    res.write(formatSseEvent({ event: "error", data: { message } }));
    res.end();
}

// forwards the agent's events to the browser as they arrive, and saves the final
// messages on the way through so they are still there when the page reloads
function relayAgentStream(stream: Readable, res: Response, conversationId: string) {
    let buffer = "";
    let saves = Promise.resolve();
    let saveError: unknown;

    const saveAssistantMessage = (block: string) => {
        const event = parseSseEvent(block);
        if (event?.event !== "question" && event?.event !== "complete") return;

        const isQuestion = event.event === "question";
        // chain the saves so messages always go into the db in order
        saves = saves.then(async () => {
            await db.orm.public.Conversation.create({
                conversation_id: conversationId,
                Content: isQuestion ? event.data.question : event.data.message,
                From: "ASSISTANT",
                ConversationType: "TEXT_MESSAGE",
                toolcall: isQuestion ? "QNA" : null,
            });
        }).catch((error) => {
            saveError = error;
        });
    };

    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
        // a chunk can end in the middle of an event, so keep the unfinished part for next time
        buffer += chunk;
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        blocks.forEach(saveAssistantMessage);
    });
    stream.on("error", (error) => sendSseError(res, error));
    stream.on("end", async () => {
        await saves;
        if (saveError) sendSseError(res, saveError);
        else res.end();
    });
    stream.pipe(res, { end: false });
}

export async function getConversationHistory(req: Request<{ projectid: string }>, res: Response) {
    try {
        const project = await findUserProject(req.params.projectid, req.userId);
        if (!project) {
            res.status(404).json({ error: "project not found" });
            return;
        }

        const histories = await db.orm.public.ConversationHistory
            .where({ projectId: project.id })
            .include("convos", (convos) => convos.orderBy((conversation) => conversation.createdAt.asc()))
            .orderBy((history) => history.createdAt.asc())
            .all();

        // agentState holds the agent's full history, the frontend only needs the question
        res.json(histories.map(({ agentState, ...history }) => {
            if (!agentState) return { ...history, pendingQuestion: null };
            const { call_id, question } = JSON.parse(agentState);
            return { ...history, pendingQuestion: { conversation_id: history.id, call_id, question } };
        }));
    } catch (error) {
        console.error("Could not load conversation history:", error);
        res.status(500).json({ error: "could not load the conversation" });
    }
}

export async function sendMessage(req: Request<{ projectid: string }>, res: Response) {
    const result = messageSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: result.error.issues.map((issue) => issue.message).join(". ") });
        return;
    }
    const { projectid } = req.params;
    const { message } = result.data;

    try {
        const project = await findUserProject(projectid, req.userId);
        if (!project) {
            res.status(404).json({ error: "project not found" });
            return;
        }
        const conversation = await db.orm.public.ConversationHistory.create({ projectId: projectid });
        await saveUserMessage(conversation.id, message);

        startSse(res);
        const stream = await streamFromAgent("loop", { conversation_id: conversation.id, message, project_id: projectid });
        relayAgentStream(stream, res, conversation.id);
    } catch (error) {
        if (!res.headersSent) startSse(res);
        sendSseError(res, error);
    }
}

export async function answerQuestion(req: Request<{ projectid: string }>, res: Response) {
    const result = answerSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: result.error.issues.map((issue) => issue.message).join(". ") });
        return;
    }
    const { projectid } = req.params;
    const { conversation_id, call_id, answer } = result.data;

    try {
        const project = await findUserProject(projectid, req.userId);
        if (!project) {
            res.status(404).json({ error: "project not found" });
            return;
        }
        // make sure this conversation really belongs to the project we just checked
        const conversation = await db.orm.public.ConversationHistory
            .where({ id: conversation_id, projectId: projectid })
            .first();
        if (!conversation) {
            res.status(404).json({ error: "conversation not found for this project" });
            return;
        }
        await saveUserMessage(conversation_id, answer);

        startSse(res);
        const stream = await streamFromAgent("resume", { project_id: projectid, conversation_id, call_id, answer });
        relayAgentStream(stream, res, conversation_id);
    } catch (error) {
        if (!res.headersSent) startSse(res);
        sendSseError(res, error);
    }
}
