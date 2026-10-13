import axios from "axios";
import type { Request, Response } from "express";
import { db } from "../../db/db";
import { initialproject } from "../types/types";

const agentOrigin = process.env.AGENT_ORIGIN ?? "http://localhost:3001";
const agentApiKey = process.env.AGENT_API_KEY ?? "local-development-agent-key";

export async function getTodos(req: Request<{ projectid: string }>, res: Response) {
    try {
        const { projectid } = req.params;
        const project = await db.orm.public.Project.where({ id: projectid, userid: req.userId }).first();
        if (!project) {
            res.status(404).json({ error: "project not found" });
            return;
        }

        const todos = await db.orm.public.Todo
            .where({ projectId: projectid })
            .orderBy((todo) => todo.position.asc())
            .all();
        res.json(todos);
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
}

export async function createProject(req: Request, res: Response) {
    const result = initialproject.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ message: result.error });
        return;
    }

    const user_id = req.userId;
    if (!user_id) {
        res.status(401).json({ error: "authentication required" });
        return;
    }
    const { title, initialPrompt } = result.data;
    try {
        const user = await db.orm.public.User.where({ id: user_id }).first();
        if (!user) {
            res.status(404).json({ error: "user not found" });
            return;
        }

        const project = await db.orm.public.Project.create({
            userid: user_id,
            title: title.trim(),
            initialPrompt: initialPrompt.trim(),
        });
        let workspaceError: string | undefined;
        let previewUrl: string | undefined;
        try {
            const initialized = await axios.post<{ previewUrl: string }>(
                `${agentOrigin}/api/v1/agent/projects/${project.id}/initialize`,
                {},
                { headers: { "x-agent-key": agentApiKey } },
            );
            previewUrl = initialized.data.previewUrl;
        } catch (error) {
            const responseError = axios.isAxiosError(error) ? error.response?.data?.error : undefined;
            workspaceError = typeof responseError === "string"
                ? responseError
                : error instanceof Error ? error.message : String(error);
        }

        res.status(201).json({
            ...project,
            ...(previewUrl ? { previewUrl } : {}),
            ...(workspaceError ? { workspaceError } : {}),
        });
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
