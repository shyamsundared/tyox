import axios from "axios";
import type { Request, Response } from "express";
import { db } from "../../db/db";
import { initialproject } from "../types/types";

const agentOrigin = process.env.AGENT_ORIGIN ?? "http://localhost:3001";
const agentApiKey = process.env.AGENT_API_KEY ?? "local-development-agent-key";



export async function createProject(req: Request, res: Response) {
    const result = initialproject.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ message: result.error });
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
        
        let previewUrl: string | undefined;
        try {
            const initialized = await axios.post<{ previewUrl: string }>(
                `${agentOrigin}/api/v1/agent/projects/${project.id}/initialize`,
                {},
                { headers: { "x-agent-key": agentApiKey } },
            );
            previewUrl = initialized.data.previewUrl;
            return res.status(201).json({
                ...project,
                previewUrl,
                workspaceError:null
            })
        } catch (error) {
            let workspaceError="couldn't initialize remote workspace"
            const responseError = axios.isAxiosError(error) ? error.response?.data?.error : undefined;
            workspaceError = typeof responseError === "string"
                ? responseError
                : error instanceof Error ? error.message : String(error);
        }

        
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
}

async function updateWorkspaceLease(
    req: Request<{ projectid: string }, unknown, { clientId?: unknown }>,
    res: Response,
    action: "heartbeat" | "disconnect",
) {
    const clientId = req.body?.clientId;
    if (typeof clientId !== "string" || !clientId.trim() || clientId.length > 128) {
        res.status(400).json({ error: "clientId is required" });
        return;
    }

    try {
        const project = await db.orm.public.Project.where({ id: req.params.projectid, userid: req.userId }).first();
        if (!project) {
            res.status(404).json({ error: "project not found" });
            return;
        }

        await axios.post(
            `${agentOrigin}/api/v1/agent/projects/${encodeURIComponent(project.id)}/workspace/${action}`,
            { clientId },
            { headers: { "x-agent-key": agentApiKey }, timeout: 10_000 },
        );
        res.status(204).end();
    } catch (error) {
        console.error(JSON.stringify({
            event: `workspace_${action}_request_failed`,
            projectId: req.params.projectid,
            userId: req.userId,
            error: error instanceof Error ? error.message : String(error),
        }));
        res.status(502).json({ error: "The project workspace could not be reached." });
    }
}

export async function heartbeatWorkspace(req: Request<{ projectid: string }, unknown, { clientId?: unknown }>, res: Response) {
    await updateWorkspaceLease(req, res, "heartbeat");
}

export async function disconnectWorkspace(req: Request<{ projectid: string }, unknown, { clientId?: unknown }>, res: Response) {
    await updateWorkspaceLease(req, res, "disconnect");
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
