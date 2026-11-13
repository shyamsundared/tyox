import { db } from "../db/db";
import type { PendingRun } from "./types";

export async function savePendingRun(conversationId: string, pending: PendingRun | null) {
    await db.orm.public.ConversationHistory
        .where({ id: conversationId })
        .update({ agentState: pending ? JSON.stringify(pending) : null });
}

export async function loadPendingRun(conversationId: string): Promise<PendingRun | null> {
    const conversation = await db.orm.public.ConversationHistory
        .where({ id: conversationId })
        .first();
    if (!conversation?.agentState) return null;
    return JSON.parse(conversation.agentState) as PendingRun;
}
