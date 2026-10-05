import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState, type FormEvent } from "react";
import type { AgentClientEvent } from "../../shared/agent-events";

type ChatMessage = { role: "user" | "assistant"; content: string };
type PendingQuestion = { conversation_id: string; call_id: string; question: string };
type Project = { id: string; title: string; initialPrompt: string };
type Todo = { id: string; title: string; description: string | null; completed: boolean };
type HistoryEntry = {
  id: string;
  convos: { From: "USER" | "ASSISTANT"; Content: string }[];
  pendingQuestion: PendingQuestion | null;
};
type Account = { id: string; username: string };
const API_ORIGIN = (window as Window & { TYOX_API_URL?: string }).TYOX_API_URL ?? "http://localhost:3000";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, init);
  const body = await response.text();
  let data: unknown = null;
  try { data = body ? JSON.parse(body) : null; } catch { data = body; }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : data;
    throw new Error(typeof message === "string" ? message : `Request failed (${response.status})`);
  }
  return data as T;
}

async function readAgentStream(response: Response, onEvent: (event: AgentClientEvent) => void) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed (${response.status})`);
  }
  if (!response.body) throw new Error("The server returned an empty response stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const dispatch = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length) onEvent({ event, data: JSON.parse(data.join("\n")) } as AgentClientEvent);
  };

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

function eventMessage(event: AgentClientEvent): string {
  switch (event.event) {
    case "question":
      return event.data.question;
    case "complete":
      return event.data.message;
    case "error":
      throw new Error(event.data.message);
  }
}

function jsonBody(value: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) };
}

export function AgentChat() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const authenticate = async (action: "login" | "signup") => {
    if (!username.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<Account>(`/api/v1/${action}`, jsonBody({ username: username.trim(), password }));
      setAccount(result);
      const ownedProjects = await requestJson<Project[]>(`/api/v1/users/${encodeURIComponent(result.id)}/projects`);
      setProjects(ownedProjects);
      setProjectId("");
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const selectProject = async (id: string) => {
    if (!id) {
      setProjectId("");
      setMessages([]);
      setPending(null);
      setTodos([]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const [history, projectTodos] = await Promise.all([
        requestJson<HistoryEntry[]>(`/api/v1/projects/${encodeURIComponent(id)}/conversations`),
        requestJson<Todo[]>(`/api/v1/${encodeURIComponent(id)}/todos`),
      ]);
      setProjectId(id);
      setMessages(history.flatMap((entry) => entry.convos.map((message) => ({
        role: message.From === "USER" ? "user" as const : "assistant" as const,
        content: message.Content,
      }))));
      setPending([...history].reverse().find((entry) => entry.pendingQuestion)?.pendingQuestion ?? null);
      setTodos(projectTodos);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!account || !projectTitle.trim() || busy) return;
    setBusy(true);
    setError("");
    let starter: { id: string; message: string } | null = null;
    try {
      const project = await requestJson<Project>("/api/v1/projects", jsonBody({
        user_id: account.id,
        title: projectTitle.trim(),
        initialPrompt: initialPrompt.trim(),
      }));
      setProjects((current) => [project, ...current]);
      setProjectTitle("");
      setInitialPrompt("");
      setProjectId(project.id);
      setMessages([]);
      setPending(null);
      setTodos([]);
      if (project.initialPrompt.trim()) {
        setMessages([{ role: "user", content: project.initialPrompt }]);
        starter = { id: project.id, message: project.initialPrompt };
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
    if (starter) void send(starter.id, { message: starter.message });
  };

  const handleEvent = (event: AgentClientEvent) => {
    const content = eventMessage(event);
    if (content) setMessages((current) => [...current, { role: "assistant", content }]);
    if (event.event === "question") setPending(event.data);
    if (event.event === "complete") setPending(null);
  };

  const send = async (id: string, body: unknown, resume = false) => {
    setError("");
    setBusy(true);
    try {
      const path = `/api/v1/${encodeURIComponent(id)}${resume ? "/answer" : ""}`;
      const response = await fetch(`${API_ORIGIN}${path}`, jsonBody(body));
      await readAgentStream(response, handleEvent);
      if (account) {
        const refreshed = await requestJson<Todo[]>(`/api/v1/${encodeURIComponent(id)}/todos`);
        setTodos(refreshed);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !projectId || busy) return;
    setMessages((current) => [...current, { role: "user", content: message }]);
    setDraft("");
    if (pending) {
      void send(projectId, {
        conversation_id: pending.conversation_id,
        call_id: pending.call_id,
        answer: message,
      }, true);
    } else {
      void send(projectId, { message });
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-5 p-5 sm:p-8">
      <header className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">Tyox</p>
        <h1 className="text-3xl font-semibold tracking-tight">Project assistant</h1>
        <p className="text-sm text-muted-foreground">Plan work, answer questions, and continue project conversations.</p>
      </header>

      {!account ? (
        <form className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1fr_auto_auto]" onSubmit={(event) => { event.preventDefault(); void authenticate("login"); }}>
          <Input aria-label="Username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" autoComplete="username" />
          <Input aria-label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete="current-password" />
          <Button type="submit" disabled={busy}>Sign in</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void authenticate("signup")}>Create account</Button>
        </form>
      ) : (
        <section className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-2 sm:col-span-2">
            <p className="text-sm">Signed in as <strong>{account.username}</strong></p>
            <Button type="button" variant="ghost" onClick={() => { setAccount(null); setProjectId(""); setProjects([]); setMessages([]); setTodos([]); setPending(null); }}>Sign out</Button>
          </div>
          <label className="grid gap-2 text-sm font-medium sm:col-span-2">
            Project
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={projectId} onChange={(event) => void selectProject(event.target.value)} disabled={busy}>
              <option value="">Choose a project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
          </label>
          <form onSubmit={(event) => void createProject(event)} className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
            <Input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="New project title" aria-label="New project title" />
            <Input value={initialPrompt} onChange={(event) => setInitialPrompt(event.target.value)} placeholder="First task (optional)" aria-label="First task" />
            <Button type="submit" className="sm:col-span-2" disabled={busy || !projectTitle.trim()}>Create project</Button>
          </form>
        </section>
      )}

      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p>}

      {account && projectId && (
        <>
          <section aria-live="polite" className="flex min-h-72 flex-col gap-3 rounded-lg border bg-card p-4">
            {messages.length === 0 && <p className="m-auto text-sm text-muted-foreground">Your conversation will appear here.</p>}
            {messages.map((message, index) => (
              <article key={`${index}-${message.role}`} className={`max-w-[90%] whitespace-pre-wrap rounded-lg px-4 py-3 text-sm ${message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "mr-auto bg-muted"}`}>
                {message.content}
              </article>
            ))}
            {busy && <p className="text-sm text-muted-foreground">Agent is working…</p>}
          </section>

          {todos.length > 0 && <section className="rounded-lg border p-4">
            <h2 className="mb-3 font-semibold">Project tasks</h2>
            <ol className="list-decimal space-y-2 pl-5">{todos.map((todo) => <li key={todo.id} className={todo.completed ? "text-muted-foreground line-through" : ""}>
              <span className="font-medium">{todo.title}</span>{todo.description && <span className="ml-2 text-sm text-muted-foreground">{todo.description}</span>}
            </li>)}</ol>
          </section>}

          <form onSubmit={submitMessage} className="flex flex-col gap-3">
            <label htmlFor="message" className="text-sm font-medium">
              {pending ? "Reply to the agent" : "What should the agent do?"}
            </label>
            <Textarea
              id="message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={pending ? "Type your answer" : "Describe the task"}
              rows={3}
              disabled={busy}
            />
            <Button type="submit" disabled={busy || !draft.trim()}>
              {pending ? "Send reply" : "Send task"}
            </Button>
          </form>
        </>
      )}
    </main>
  );
}
