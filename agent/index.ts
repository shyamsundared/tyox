import express from "express";
import cors from "cors";
import { main, resume, type WaitingForUser } from "./output";

const app = express();
app.use(express.json());
app.use(cors());

type PendingRun = Pick<WaitingForUser, "history" | "call_id" | "tool_name">;
// Pending runs are keyed by conversation so simultaneous users do not share history.
// Replace this process-local store with database persistence before running multiple workers.
const pendingRuns = new Map<string, PendingRun>();

function startSse(res: express.Response) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
}

function sendEvent(res: express.Response, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function sendRun(res: express.Response, result: Awaited<ReturnType<typeof main>>) {
    if (result.state === "waiting_for_user") {
        pendingRuns.set(result.convo_id, {
            history: result.history,
            call_id: result.call_id,
            tool_name: result.tool_name,
        });
        sendEvent(res, "question", {
            conversation_id: result.convo_id,
            call_id: result.call_id,
            question: result.question,
        });
    } else {
        sendEvent(res, "complete", { state: result.state, output: result.output });
    }
    res.end();
}

app.post("/api/v1/agent/loop", async (req, res) => {
    const { conversation_id, message } = req.body as {
        conversation_id?: string;
        message?: string;
    };
    if (!conversation_id || typeof message !== "string") {
        res.status(400).json({ error: "conversation_id and message are required" });
        return;
    }

    startSse(res);
    try {
        await sendRun(res, await main(message, [], conversation_id));
    } catch (error) {
        sendEvent(res, "error", { message: error instanceof Error ? error.message : String(error) });
        res.end();
    }
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

    const pending = pendingRuns.get(conversation_id);
    if (!pending || pending.call_id !== call_id) {
        res.status(409).json({ error: "No matching pending question for this conversation" });
        return;
    }

    // Remove before resuming so the same answer cannot be submitted twice.
    pendingRuns.delete(conversation_id);
    startSse(res);
    try {
        const result = await resume(
            pending.history,
            conversation_id,
            pending.call_id,
            pending.tool_name,
            answer,
        );
        await sendRun(res, result);
    } catch (error) {
        sendEvent(res, "error", { message: error instanceof Error ? error.message : String(error) });
        res.end();
    }
});

app.listen(3001, () => {
    console.log("Agent backend listening on http://localhost:3001");
});
