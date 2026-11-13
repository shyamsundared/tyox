import { z } from "zod";

export const authSchema = z.object({
    username: z.string().min(1, "name is required"),
    password: z.string().min(7, "minimum seven characters"),
});

export const createProjectSchema = z.object({
    title: z.string().trim().min(1, "Project title is required"),
    initialPrompt: z.string().trim().min(1, "Initial prompt is required"),
});

export const messageSchema = z.object({
    message: z.string().trim().min(1, "message is required").max(20_000, "message is too long"),
});

export const answerSchema = z.object({
    conversation_id: z.string().min(1, "conversation_id is required"),
    call_id: z.string().min(1, "call_id is required"),
    answer: z.string().trim().min(1, "answer is required").max(20_000, "answer is too long"),
});
