import type { Request, Response } from "express";
import { db } from "../../db/db";
import { initializeWorkspace } from "../agent-client";
import { createProjectSchema } from "../schemas";

export async function createProject(req: Request, res: Response) {
    const result = createProjectSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: result.error.issues.map((issue) => issue.message).join(". ") });
        return;
    }

    try {
        const { title, initialPrompt } = result.data;
        const project = await db.orm.public.Project.create({ userid: req.userId, title, initialPrompt });

        try {
            const previewUrl = await initializeWorkspace(project.id);
            res.status(201).json({ ...project, previewUrl });
        } catch (error) {
            // the project is already saved, so still return it. the sandbox gets created again on the next prompt
            console.error(`Could not start workspace for project ${project.id}:`, error instanceof Error ? error.message : error);
            res.status(201).json({
                ...project,
                workspaceError: "Project saved, but its workspace could not start. Try sending a prompt again.",
            });
        }
    } catch (error) {
        console.error("Could not create project:", error);
        res.status(500).json({ error: "could not create the project" });
    }
}

export async function listUserProjects(req: Request<{ userid: string }>, res: Response) {
    if (req.params.userid !== req.userId) {
        res.status(403).json({ error: "cannot access another user's projects" });
        return;
    }

    try {
        const projects = await db.orm.public.Project
            .where({ userid: req.userId })
            .orderBy((project) => project.createdAt.desc())
            .all();
        res.json(projects);
    } catch (error) {
        console.error("Could not list projects:", error);
        res.status(500).json({ error: "could not load projects" });
    }
}
