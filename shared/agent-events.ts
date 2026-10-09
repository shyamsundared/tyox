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
export type UpdateEvent={
    event:"update";
    data:{message:string};
}
export type PreviewEvent = {
    event: "preview";
    data: { url: string };
};
export type AgentClientEvent = QuestionEvent | CompleteEvent | ErrorEvent | UpdateEvent | PreviewEvent;

export function formatSseEvent(event: AgentClientEvent): string {
    return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
