import { z } from "zod";

export const createProjectSchema = z.object({
    title: z.string().trim().min(1, "Project title is required"),
    initialPrompt: z.string().trim().min(1, "Initial prompt is required"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
