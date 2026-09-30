import axios from "axios";
import express from "express";
import bcrypt from "bcrypt";
import type { Readable } from "node:stream";
import { db } from "../db/db";

const app = express();
app.use(express.json());

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
    res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    res.end();
}

function relayAgentStream(stream: Readable, res: express.Response) {
    stream.on("error", (error: unknown) => writeSseError(res, error));
    stream.on("end", () => {
        if (!res.writableEnded) res.end();
    });
    stream.pipe(res, { end: false });
}

app.post("/api/v1/:projectid", async (req, res) => {
    const { projectid } = req.params;
    const { message } = req.body as { message?: string };
    if (typeof message !== "string" || !message.trim()) {
        res.status(400).json({ error: "message is required" });
        return;
    }

    try {
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
        relayAgentStream(agentResponse.data, res);
    } catch (error) {
        writeSseError(res, error);
    }
});

app.post("/api/v1/:projectid/answer", async (req, res) => {
    const { conversation_id, call_id, answer } = req.body as {
        conversation_id?: string;
        call_id?: string;
        answer?: string;
    };
    if (!conversation_id || !call_id || typeof answer !== "string" || !answer.trim()) {
        res.status(400).json({ error: "conversation_id, call_id, and answer are required" });
        return;
    }

    startSse(res);
    try {
        const agentResponse = await axios.post(
            "http://localhost:3001/api/v1/agent/resume",
            { conversation_id, call_id, answer },
            { responseType: "stream" },
        );
        relayAgentStream(agentResponse.data, res);
    } catch (error) {
        writeSseError(res, error);
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

app.listen(3000, () => {
    console.log("Backend listening on http://localhost:3000");
});
