import axios from "axios";
import express from "express";
import bcrypt from "bcrypt";
import type { Readable } from "node:stream";
import { db } from "../db/db";
import { formatSseEvent, type AgentClientEvent } from "../shared/agent-events";

const app = express();
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3002";
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", frontendOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }
    next();
});
app.use(express.json());

app.get("/api/v1/:projectid/todos", async (req, res) => {
    try {
        const { projectid } = req.params;
        const project = await db.orm.public.Project.where({ id: projectid }).first();
        if (!project) {
            res.status(404).json({ error: "project not found" });
            return;
        }
        const todos = await db.orm.public.Todo
            .where({ projectId: projectid })
            .orderBy((todo) => todo.position.asc())
            .all();
        res.json(todos);
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

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
    const captureEvent = (block: string) => {
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
            const content = event.event === "question" ? event.data.question : event.data.message;
            if (!content.trim()) return;
            pendingWrites = pendingWrites.then(() => db.orm.public.Conversation.create({
                conversation_id: conversationId,
                Content: content,
                From: "ASSISTANT",
                ConversationType: "TEXT_MESSAGE",
                toolcall: eventName === "question" ? "QNA" : null,
            }).then(() => undefined));
        } catch (error) {
            pendingWrites = pendingWrites.then(() => Promise.reject(error));
        }
    };

    stream.on("data", (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) captureEvent(block);
    });
    stream.on("error", (error: unknown) => writeSseError(res, error));
    stream.on("end", async () => {
        if (buffer.trim()) captureEvent(buffer);
        try {
            await pendingWrites;
            if (!res.writableEnded) res.end();
        } catch (error) {
            writeSseError(res, error);
        }
    });
    stream.pipe(res, { end: false });
}

app.post("/api/v1/projects", async (req, res) => {
    const { user_id, title, initialPrompt = "" } = req.body as {
        user_id?: string;
        title?: string;
        initialPrompt?: string;
    };
    if (!user_id || typeof title !== "string" || !title.trim() || typeof initialPrompt !== "string") {
        res.status(400).json({ error: "user_id, title, and an optional initialPrompt are required" });
        return;
    }
    try {
        const user = await db.orm.public.User.where({ id: user_id }).first();
        if (!user) {
            res.status(404).json({ error: "user not found" });
            return;
        }
        const project = await db.orm.public.Project.create({
            userid: user_id,
            title: title.trim(),
            initialPrompt: initialPrompt.trim(),
        });
        res.status(201).json(project);
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.get("/api/v1/users/:userid/projects", async (req, res) => {
    try {
        const projects = await db.orm.public.Project
            .where({ userid: req.params.userid })
            .orderBy((project) => project.createdAt.desc())
            .all();
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.get("/api/v1/projects/:projectid/conversations", async (req, res) => {
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
                    // Invalid persisted agent state should not prevent the rest of the project history loading.
                }
            }
            return { ...history, pendingQuestion };
        }));
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.post("/api/v1/signup", async (req, res) => {
    try {
        const { username, password } = req.body as { username?: string; password?: string };
        if (!username || !password) {
            res.status(400).json({ error: "username and password are required" });
            return;
        }
        const hashpassword = await bcrypt.hash(password, 10);
        const response = await db.orm.public.User.create({ username, password: hashpassword });
        res.status(201).json({ id: response.id, username: response.username });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.post("/api/v1/login", async (req, res) => {
    try {
        const { username, password } = req.body as { username?: string; password?: string };
        if (!username || !password) {
            res.status(400).json({ error: "username and password are required" });
            return;
        }
        const user = await db.orm.public.User.where({ username }).first();
        if (!user || !(await bcrypt.compare(password, user.password))) {
            res.status(401).json({ error: "invalid username or password" });
            return;
        }
        res.json({ id: user.id, username: user.username });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.post("/api/v1/:projectid", async (req, res) => {
    const { projectid } = req.params;
    const { message } = req.body as { message?: string };
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
        const conversation = await db.orm.public.ConversationHistory.create({
            projectId: projectid,
        });
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
});

app.post("/api/v1/:projectid/answer", async (req, res) => {
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
});

app.listen(3000, () => {
    console.log("Backend listening on http://localhost:3000");
});
