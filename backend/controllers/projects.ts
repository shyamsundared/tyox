import axios from "axios";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { db } from "../../db/db";
import { createProjectSchema } from "../schemas/project-schema";
const agentOrigin = process.env.AGENT_ORIGIN ?? "http://localhost:3001";
const agentApiKey = process.env.AGENT_API_KEY ?? "local-development-agent-key";

export async function createProject(req: Request, res: Response) {
    const result = createProjectSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: result.error.issues.map((issue) => issue.message).join(". ") });
        return;
    }

    const userid = req.userId;

    const { title, initialPrompt } = result.data;
    try {
        const user = await db.orm.public.User.where({ id: userid }).first();
        if (!user) {
            res.status(404).json({ error: "user not found" });
            return;
        }
    
        const project = await db.orm.public.Project.create({
            userid,
            title,
            initialPrompt,
        });
        
        try {
            const initialized = await axios.post<{ previewUrl: string }>(
                `${agentOrigin}/api/v1/agent/projects/${project.id}/initialize`,
                {},
                { headers: { "x-agent-key": agentApiKey }, timeout: 310_000 },
            );
            res.status(201).json({ ...project, previewUrl: initialized.data.previewUrl });
        } catch (error) {
            const errorReference = randomUUID();
            console.error(JSON.stringify({
                event: "project_initialization_failed",
                projectId: project.id,
                errorReference,
                error: error instanceof Error ? error.message : String(error),
            }));
            // The project row exists even when the remote workspace is unavailable.
            res.status(201).json({
                ...project,
                workspaceError: `Project saved, but its workspace could not start. Try sending a prompt again. Reference: ${errorReference}`,
            });
        }
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
}

export async function getTodos(req: Request<{ projectid: string }>, res: Response) {
    try {
        const project = await db.orm.public.Project
            .where({ id: req.params.projectid, userid: req.userId })
            .first();

        if (!project) {
            res.status(404).json({ error: "project not found" });
            return;
        }

        const todos = await db.orm.public.Todo
            .where({ projectId: project.id })
            .orderBy((todo) => todo.position.asc())
            .all();

        res.json(todos);
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
}
