import type { AgentClientEvent } from "../../shared/agent-events";
import { createParser } from "eventsource-parser";

const configuredApiOrigin = (window as Window & { TYOX_API_URL?: string }).TYOX_API_URL;

const API_ORIGIN =
  configuredApiOrigin && configuredApiOrigin !== "__TYOX_API_URL__"
    ? configuredApiOrigin.replace(/\/+$/, "")
    : "http://localhost:3000";
const TOKEN_KEY = "tyox_access_token";
const ACCOUNT_KEY = "tyox_account";

export type SavedAccount = { id: string; username: string };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export function saveAuthToken(token: string | null, account?: SavedAccount) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
  }
}

export function getSavedAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getSavedAccount(): SavedAccount | null {
  if (!localStorage.getItem(TOKEN_KEY)) return null;

  try {
    const value: unknown = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "id" in value && typeof value.id === "string" &&
      "username" in value && typeof value.username === "string"
    ) {
      return { id: value.id, username: value.username };
    }
  } catch {
    // A malformed saved account should behave like a signed-out session.
  }

  return null;
}

function withAuth(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, withAuth(init));
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
      : data && typeof data === "object" && "message" in data
        ? (data as { message: unknown }).message
        : data;
    throw new ApiError(typeof message === "string" ? message : `Request failed (${response.status})`, response.status);
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
  const parser = createParser({
    onEvent(message) {
      onEvent({
        event: message.event || "message",
        data: JSON.parse(message.data),
      } as AgentClientEvent);
    },
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        parser.feed(decoder.decode());
        parser.reset({ consume: true });
        break;
      }

      parser.feed(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}

export async function sendAgentRequest(
  path: string,
  body: unknown,
  onEvent: (event: AgentClientEvent) => void,
): Promise<void> {
  const response = await fetch(`${API_ORIGIN}${path}`, withAuth(jsonBody(body)));
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
