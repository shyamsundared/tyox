import axios from "axios";
import type { Readable } from "node:stream";

const agentOrigin = process.env.AGENT_ORIGIN ?? "http://localhost:3001";
const headers = { "x-agent-key": process.env.AGENT_API_KEY ?? "local-development-agent-key" };

// a little longer than the agent's own 5 minute limit, so the agent always gives up first
const AGENT_TIMEOUT_MS = 330_000;

export async function initializeWorkspace(projectId: string): Promise<string> {
    const response = await axios.post<{ previewUrl: string }>(
        `${agentOrigin}/api/v1/agent/projects/${projectId}/initialize`,
        {},
        { headers, timeout: AGENT_TIMEOUT_MS },
    );
    return response.data.previewUrl;
}

export async function streamFromAgent(path: "loop" | "resume", body: object): Promise<Readable> {
    const response = await axios.post(`${agentOrigin}/api/v1/agent/${path}`, body, {
        headers,
        responseType: "stream",
        timeout: AGENT_TIMEOUT_MS,
    });
    return response.data;
}
