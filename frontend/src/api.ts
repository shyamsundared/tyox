import { parseSseEvent } from "../../shared/agent-events";
import type { AgentClientEvent } from "../../shared/agent-events";
import type { Account } from "./types";

// index.ts replaces the placeholder in production with the real backend url
const configuredUrl = (window as Window & { TYOX_API_URL?: string }).TYOX_API_URL;
const API_URL = configuredUrl && configuredUrl !== "__TYOX_API_URL__"
  ? configuredUrl.replace(/\/+$/, "")
  : "http://localhost:3000";

const TOKEN_KEY = "tyox_access_token";
const ACCOUNT_KEY = "tyox_account";

// keeps the status code so we can tell when a session has expired
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function saveSession(token: string, account: Account) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
}

export function getSavedAccount(): Account | null {
  const account = localStorage.getItem(ACCOUNT_KEY);
  if (!account || !localStorage.getItem(TOKEN_KEY)) return null;

  try {
    return JSON.parse(account) as Account;
  } catch {
    return null;
  }
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ""}`,
  };
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { headers: headers() });
  return readJson<T>(response);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  return readJson<T>(response);
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.error ?? `Request failed (${response.status})`, response.status);
  }
  return data as T;
}

// can't use EventSource here because it only supports GET and can't send the auth header,
// so we read the response body ourselves
export async function streamAgent(path: string, body: unknown, onEvent: (event: AgentClientEvent) => void) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!response.ok) await readJson(response);
  if (!response.body) throw new Error("The server returned an empty response");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // events can get split across chunks, so only handle the ones that are complete
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const event = parseSseEvent(block);
      if (event) onEvent(event);
    }
  }
}
