import { useEffect, useState } from "react";
import type { AgentClientEvent } from "../../../shared/agent-events";
import { ApiError, clearSession, getJson, postJson, streamAgent } from "../api";
import type { Account, ChatMessage, HistoryEntry, PendingQuestion, Project } from "../types";
import { ChatPanel } from "./ChatPanel";
import { PreviewPanel } from "./PreviewPanel";
import { Sidebar } from "./Sidebar";

type Props = {
  account: Account;
  onSignOut: (expired: boolean) => void;
};

export function Workspace({ account, onSignOut }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [activeView, setActiveView] = useState<"chat" | "preview">("chat");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const signOut = (expired: boolean) => {
    clearSession();
    onSignOut(expired);
  };

  const showError = (cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) {
      signOut(true);
      return;
    }
    setError(cause instanceof Error ? cause.message : String(cause));
  };

  useEffect(() => {
    getJson<Project[]>(`/api/v1/users/${account.id}/projects`).then(setProjects).catch(showError);
  }, [account.id]);

  const openProject = (project: Project) => {
    setProjectId(project.id);
    setPreviewUrl(project.previewUrl ?? "");
    setActiveView(project.previewUrl ? "preview" : "chat");
  };

  const selectProject = async (id: string) => {
    const project = projects.find((item) => item.id === id);
    if (!project) return;

    setBusy(true);
    setError("");
    try {
      const history = await getJson<HistoryEntry[]>(`/api/v1/projects/${id}/conversations`);
      openProject(project);
      setMessages(history.flatMap((entry) => entry.convos.map((message): ChatMessage => ({
        role: message.From === "USER" ? "user" : "assistant",
        content: message.Content,
      }))));
      // only the newest question can still be waiting for an answer
      setPending(history.findLast((entry) => entry.pendingQuestion)?.pendingQuestion ?? null);
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const createProject = async (title: string, initialPrompt: string) => {
    setBusy(true);
    setError("");
    try {
      const project = await postJson<Project>("/api/v1/projects", { title, initialPrompt });
      setProjects((current) => [project, ...current]);
      setShowCreateForm(false);
      openProject(project);
      setError(project.workspaceError ?? "");
      setMessages([{ role: "user", content: project.initialPrompt }]);
      setPending(null);
      await runAgent(project.id, `/api/v1/${project.id}`, { message: project.initialPrompt });
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };

  const handleEvent = (event: AgentClientEvent, runProjectId: string) => {
    switch (event.event) {
      case "update":
        setStatus(event.data.message);
        break;
      case "preview":
        setPreviewUrl(event.data.url);
        setActiveView("preview");
        setProjects((current) => current.map((project) => (
          project.id === runProjectId ? { ...project, previewUrl: event.data.url } : project
        )));
        break;
      case "question":
        setMessages((current) => [...current, { role: "assistant", content: event.data.question }]);
        setPending(event.data);
        break;
      case "complete":
        setMessages((current) => [...current, { role: "assistant", content: event.data.message }]);
        setPending(null);
        break;
      case "error":
        throw new Error(event.data.message);
    }
  };

  const runAgent = async (id: string, path: string, body: object) => {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      await streamAgent(path, body, (event) => handleEvent(event, id));
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const sendMessage = (message: string) => {
    setMessages((current) => [...current, { role: "user", content: message }]);
    if (pending) {
      const { conversation_id, call_id } = pending;
      void runAgent(projectId, `/api/v1/${projectId}/answer`, { conversation_id, call_id, answer: message });
    } else {
      void runAgent(projectId, `/api/v1/${projectId}`, { message });
    }
  };

  const projectTitle = projects.find((project) => project.id === projectId)?.title ?? "Your projects";

  return (
    <div className="h-screen flex flex-col md:flex-row">
      <Sidebar
        account={account}
        projects={projects}
        selectedId={projectId}
        busy={busy}
        showCreateForm={showCreateForm}
        setShowCreateForm={setShowCreateForm}
        onSelect={(id) => void selectProject(id)}
        onCreate={(title, prompt) => void createProject(title, prompt)}
        onSignOut={() => signOut(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
          <h2 className="truncate font-semibold text-zinc-900">{projectTitle}</h2>
          {/* on big screens chat and preview are side by side, so the tabs are only for phones */}
          {projectId && (
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm lg:hidden">
              <button type="button" className={`rounded-md px-3 py-1 ${activeView === "chat" ? "bg-white shadow-sm" : "text-zinc-500"}`} onClick={() => setActiveView("chat")}>Chat</button>
              <button type="button" className={`rounded-md px-3 py-1 disabled:opacity-50 ${activeView === "preview" ? "bg-white shadow-sm" : "text-zinc-500"}`} disabled={!previewUrl} onClick={() => setActiveView("preview")}>Preview</button>
            </div>
          )}
        </header>

        {error && (
          <div role="alert" className="flex justify-between bg-red-50 px-4 py-2 text-sm text-red-700">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button>
          </div>
        )}

        {projectId ? (
          <main className="flex-1 flex min-h-0">
            <ChatPanel
              className={`flex-1 lg:flex lg:max-w-md lg:border-r lg:border-zinc-200 ${activeView === "chat" ? "flex" : "hidden"}`}
              messages={messages}
              pending={pending}
              busy={busy}
              status={status}
              onSend={sendMessage}
            />
            <PreviewPanel
              className={`flex-1 lg:flex ${activeView === "preview" ? "flex" : "hidden"}`}
              previewUrl={previewUrl}
            />
          </main>
        ) : (
          <main className="flex-1 flex flex-col items-center justify-center gap-4 bg-zinc-50 p-4 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900">What will you build today?</h2>
            <p className="text-zinc-500">Start a project and turn your idea into a working React app.</p>
            <button type="button" className="rounded-lg bg-orange-600 px-5 py-2 font-medium text-white hover:bg-orange-700" onClick={() => setShowCreateForm(true)}>Start a project</button>
          </main>
        )}
      </div>
    </div>
  );
}
