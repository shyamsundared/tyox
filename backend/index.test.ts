import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { once } from "node:events";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";

const project = { id: "project-1", userid: "user-1", title: "Demo", initialPrompt: "Build a page" };
const user = { id: "user-1", username: "shyam", password: "hashed" };
const conversation = { id: "conversation-1", projectId: project.id };

let projectExists = true;
let userExists = true;
let conversationExists = true;
let nextAgentEvents = "event: complete\ndata: {\"message\":\"Done\"}\n\n";
const savedMessages: Array<Record<string, unknown>> = [];
const agentRequests: Array<{ url: string; body: unknown }> = [];

const db = {
    orm: {
        public: {
            User: {
                where: () => ({ first: async () => userExists ? user : undefined }),
                create: async () => user,
            },
            Project: {
                where: () => ({
                    first: async () => projectExists ? project : undefined,
                    orderBy: () => ({ all: async () => [project] }),
                }),
                create: async (input: Record<string, unknown>) => ({ ...project, ...input }),
            },
            ConversationHistory: {
                create: async () => conversation,
                where: () => ({
                    first: async () => conversationExists ? conversation : undefined,
                    include: () => ({ orderBy: () => ({ all: async () => [] }) }),
                }),
            },
            Conversation: {
                create: async (input: Record<string, unknown>) => {
                    savedMessages.push(input);
                    return input;
                },
            },
            Todo: {
                where: () => ({ orderBy: () => ({ all: async () => [] }) }),
            },
        },
    },
};

mock.module("../db/db", () => ({ db }));
mock.module("axios", () => ({
    default: {
        isAxiosError: () => false,
        post: async (url: string, body?: unknown) => {
            agentRequests.push({ url, body });
            if (url.endsWith("/initialize")) {
                return { data: { previewUrl: "https://preview.example.test" } };
            }
            return { data: Readable.from([nextAgentEvents]) };
        },
    },
}));

const { app } = await import("./index");
let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let serverStarted = false;

beforeAll(async () => {
    server = app.listen(0);
    await once(server, "listening");
    serverStarted = true;
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    if (!serverStarted) return;
    await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
});

beforeEach(() => {
    projectExists = true;
    userExists = true;
    conversationExists = true;
    nextAgentEvents = "event: complete\ndata: {\"message\":\"Done\"}\n\n";
    savedMessages.length = 0;
    agentRequests.length = 0;
});

describe("project API", () => {
    it("rejects an invalid project request before creating a project", async () => {
        const response = await fetch(`${baseUrl}/api/v1/projects`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ user_id: "", title: "", initialPrompt: "" }),
        });

        expect(response.status).toBe(400);
        expect(agentRequests).toHaveLength(0);
    });

    it("creates a project and initializes its E2B preview", async () => {
        const response = await fetch(`${baseUrl}/api/v1/projects`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ user_id: user.id, title: " Demo ", initialPrompt: " Build a page " }),
        });
        const body = await response.json() as { id: string; previewUrl: string; title: string };

        expect(response.status).toBe(201);
        expect(body).toMatchObject({ id: project.id, title: "Demo", previewUrl: "https://preview.example.test" });
        expect(agentRequests[0]?.url).toBe(`http://localhost:3001/api/v1/agent/projects/${project.id}/initialize`);
    });
});

describe("conversation API", () => {
    it("persists a user prompt and relays completion events over SSE", async () => {
        nextAgentEvents = [
            "event: update\ndata: {\"message\":\"Writing the page\"}\n\n",
            "event: complete\ndata: {\"message\":\"Done\"}\n\n",
        ].join("");

        const response = await fetch(`${baseUrl}/api/v1/${project.id}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: "Build a page" }),
        });
        const stream = await response.text();

        expect(response.headers.get("content-type")).toContain("text/event-stream");
        expect(stream).toContain("event: update");
        expect(stream).toContain("event: complete");
        expect(savedMessages).toEqual(expect.arrayContaining([
            expect.objectContaining({ Content: "Build a page", From: "USER" }),
            expect.objectContaining({ Content: "Done", From: "ASSISTANT" }),
        ]));
        expect(agentRequests[0]?.body).toMatchObject({ message: "Build a page", project_id: project.id });
    });

    it("stores an answer and resumes the matching conversation", async () => {
        const response = await fetch(`${baseUrl}/api/v1/${project.id}/answer`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                conversation_id: conversation.id,
                call_id: "question-1",
                answer: "Use a dark theme",
            }),
        });
        const stream = await response.text();

        expect(response.status).toBe(200);
        expect(stream).toContain("event: complete");
        expect(savedMessages).toEqual(expect.arrayContaining([
            expect.objectContaining({ Content: "Use a dark theme", From: "USER" }),
            expect.objectContaining({ Content: "Done", From: "ASSISTANT" }),
        ]));
        expect(agentRequests[0]).toEqual({
            url: "http://localhost:3001/api/v1/agent/resume",
            body: { conversation_id: conversation.id, call_id: "question-1", answer: "Use a dark theme" },
        });
    });

    it("does not resume a conversation belonging to another project", async () => {
        conversationExists = false;
        const response = await fetch(`${baseUrl}/api/v1/another-project/answer`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ conversation_id: conversation.id, call_id: "question-1", answer: "Okay" }),
        });

        expect(response.status).toBe(404);
        expect(agentRequests).toHaveLength(0);
        expect(savedMessages).toHaveLength(0);
    });
});
