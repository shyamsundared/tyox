export type QuestionEvent = {
    event: "question";
    data: {
        conversation_id: string;
        call_id: string;
        question: string;
    };
};

export type CompleteEvent = {
    event: "complete";
    data: { message: string };
};

export type ErrorEvent = {
    event: "error";
    data: { message: string };
};

export type AgentClientEvent = QuestionEvent | CompleteEvent | ErrorEvent;

export function formatSseEvent(event: AgentClientEvent): string {
    return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
