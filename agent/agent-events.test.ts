import { describe, expect, test } from "bun:test";
import { formatSseEvent, parseSseEvent } from "../shared/agent-events";
import type { AgentClientEvent } from "../shared/agent-events";

describe("SSE event contract", () => {
    test("every event survives a format → parse round trip", () => {
        const events: AgentClientEvent[] = [
            { event: "update", data: { message: "Reading src/App.tsx..." } },
            { event: "question", data: { conversation_id: "c1", call_id: "call-1", question: "Which colour?" } },
            { event: "preview", data: { url: "https://example.test" } },
            { event: "complete", data: { message: "Done" } },
            { event: "error", data: { message: "Something broke" } },
        ];

        for (const event of events) {
            const wire = formatSseEvent(event);
            // the reader splits on the blank line, so parse receives the block without it
            expect(parseSseEvent(wire.slice(0, -2))).toEqual(event);
        }
    });

    test("a message containing blank lines stays one event on the wire", () => {
        const wire = formatSseEvent({ event: "complete", data: { message: "Done!\n\nI built a todo app." } });

        // the only blank line must be the one that ends the event
        expect(wire.split("\n\n")).toEqual([expect.any(String), ""]);
        expect(parseSseEvent(wire.slice(0, -2))).toEqual({
            event: "complete",
            data: { message: "Done!\n\nI built a todo app." },
        });
    });

    test("returns null for anything that isn't a valid event, instead of throwing", () => {
        expect(parseSseEvent("")).toBeNull();
        expect(parseSseEvent("garbage")).toBeNull();
        expect(parseSseEvent(": keep-alive comment")).toBeNull();
        expect(parseSseEvent("event: update")).toBeNull();
        expect(parseSseEvent("event: update\ndata: {not json")).toBeNull();
        expect(parseSseEvent("data: {}\nevent: update")).toBeNull();
    });

    test("a stream split into random chunks still yields every event", () => {
        const events: AgentClientEvent[] = [
            { event: "update", data: { message: "one" } },
            { event: "preview", data: { url: "https://example.test" } },
            { event: "complete", data: { message: "two\n\nlines" } },
        ];
        const stream = events.map(formatSseEvent).join("");

        // the same buffering the backend relay does: keep the unfinished piece for the next chunk
        const received: AgentClientEvent[] = [];
        let buffer = "";
        for (let i = 0; i < stream.length; i += 7) {
            buffer += stream.slice(i, i + 7);
            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() ?? "";
            for (const block of blocks) {
                const event = parseSseEvent(block);
                if (event) received.push(event);
            }
        }

        expect(received).toEqual(events);
        expect(buffer).toBe("");
    });
});
