import axios from "axios";
import type { Request, Response } from "express";
import { db } from "../../db/db";
import { initialproject } from "../types/types";

const agentOrigin = process.env.AGENT_ORIGIN ?? "http://localhost:3001";

export async function getTodos(req: Request<{ projectid: string }>, res: Response) {
    try {
        const { projectid } = req.params;
        const project = await db.orm.public.Project.where({ id: projectid }).first();
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

    const { user_id, title, initialPrompt } = result.data;
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
    try {
        const projects = await db.orm.public.Project
            .where({ userid: req.params.userid })
            .orderBy((project) => project.createdAt.desc())
            .all();
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
}
