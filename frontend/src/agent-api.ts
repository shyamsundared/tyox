import type { AgentClientEvent } from "../../shared/agent-events";

const API_ORIGIN = (window as Window & { TYOX_API_URL?: string }).TYOX_API_URL ?? "http://localhost:3000";

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, init);
  const body = await response.text();
  let data: unknown = null;

  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = body;
  }

  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data
      ? (data as { error: unknown }).error
      : data;
    throw new Error(typeof message === "string" ? message : `Request failed (${response.status})`);
  }

  return data as T;
}

export async function readAgentStream(
  response: Response,
  onEvent: (event: AgentClientEvent) => void,
): Promise<void> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed (${response.status})`);
  }
  if (!response.body) throw new Error("The server returned an empty response stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function dispatch(block: string) {
    let event = "message";
    const data: string[] = [];

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }

    if (data.length) {
      onEvent({ event, data: JSON.parse(data.join("\n")) } as AgentClientEvent);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) dispatch(block);

    if (done) break;
  }

  if (buffer.trim()) dispatch(buffer);
}

export async function sendAgentRequest(
  path: string,
  body: unknown,
  onEvent: (event: AgentClientEvent) => void,
): Promise<void> {
  const response = await fetch(`${API_ORIGIN}${path}`, jsonBody(body));
  await readAgentStream(response, onEvent);
}

export function eventMessage(
  event: Exclude<AgentClientEvent, { event: "update" | "preview" }>,
): string {
  switch (event.event) {
    case "question":
      return event.data.question;
    case "complete":
      return event.data.message;
    case "error":
      throw new Error(event.data.message);
  }
}

export function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}
