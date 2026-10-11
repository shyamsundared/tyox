import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState, type FormEvent } from "react";
import type { AgentClientEvent } from "../../shared/agent-events";
import { eventMessage, jsonBody, readAgentStream, requestJson } from "./agent-api";

type ChatMessage = { role: "user" | "assistant"; content: string };
type PendingQuestion = { conversation_id: string; call_id: string; question: string };
type Project = { id: string; title: string; initialPrompt: string; workspaceError?: string; previewUrl?: string };
type Todo = { id: string; title: string; description: string | null; completed: boolean };
type HistoryEntry = {
  id: string;
  convos: { From: "USER" | "ASSISTANT"; Content: string }[];
  pendingQuestion: PendingQuestion | null;
};
type Account = { id: string; username: string };

function Icon({ name, size = 18 }: { name: "plus" | "message" | "monitor" | "external" | "refresh" | "send" | "spark" | "folder"; size?: number }) {
  const paths = {
    plus: "M12 5v14M5 12h14",
    message: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z",
    monitor: "M3 4h18v13H3zM8 21h8M12 17v4",
    external: "M14 3h7v7M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
    refresh: "M20 7v5h-5M4 17v-5h5M5.6 9a7 7 0 0 1 11.5-2L20 12M4 12l2.9 5a7 7 0 0 0 11.5-2",
    send: "m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13",
    spark: "m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2L12 3ZM19 14l1.2 3.2L23 18l-2.8 1L19 22l-1.1-3L15 18l2.9-.8L19 14Z",
    folder: "M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
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
  const [status, setStatus] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [activeView, setActiveView] = useState<"chat" | "preview">("chat");
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);

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
      setPreviewUrl("");
      setActiveView("chat");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const [history, projectTodos] = await Promise.all([
        requestJson<HistoryEntry[]>(`/api/v1/projects/${encodeURIComponent(id)}/conversations`),
        requestJson<Todo[]>(`/api/v1/${encodeURIComponent(id)}/todos`),
      ]);
      const selectedProject = projects.find((project) => project.id === id);
      setProjectId(id);
      setPreviewUrl(selectedProject?.previewUrl ?? "");
      setActiveView(selectedProject?.previewUrl ? "preview" : "chat");
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
      setShowCreateProject(false);
      setProjectId(project.id);
      setError(project.workspaceError ?? "");
      setPreviewUrl(project.previewUrl ?? "");
      setActiveView(project.previewUrl ? "preview" : "chat");
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
    if (event.event === "update") {
      const message = event.data?.message;
      if (typeof message === "string" && message.trim() && message !== "undefined") {
        setStatus(message);
      }
      return;
    }

    if (event.event === "preview") {
      setPreviewUrl(event.data.url);
      setActiveView("preview");
      setProjects((current) => current.map((project) => project.id === projectId
        ? { ...project, previewUrl: event.data.url }
        : project));
      return;
    }

    const content = eventMessage(event);
    if (content) setMessages((current) => [...current, { role: "assistant", content }]);
    if (event.event === "question") {
      setPending(event.data);
      setStatus("");
    }
    if (event.event === "complete") {
      setPending(null);
      setStatus("");
    }
  };

  const send = async (id: string, body: unknown, resume = false) => {
    setError("");
    setStatus("");
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
      setStatus("");
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

  if (!account) {
    return (
      <main className="dark auth-screen">
        <div className="auth-glow auth-glow-one" />
        <div className="auth-glow auth-glow-two" />
        <section className="auth-layout">
          <div className="auth-intro">
            <div className="brand-lockup">
              <span className="brand-mark"><i /><i /><i /><i /></span>
              <span>tyox</span>
            </div>
            <div className="auth-copy">
              <p className="eyebrow"><Icon name="spark" size={15} /> Your AI workspace</p>
              <h1>From idea to<br /><span>working app.</span></h1>
              <p className="auth-description">Describe what you want to build. Tyox writes the React code, checks it, and brings your app to life in a live preview.</p>
            </div>
            <div className="auth-footnote"><span className="online-dot" /> Built for the way you think</div>
          </div>

          <div className="auth-card-wrap">
            <div className="auth-card">
              <div className="auth-card-heading">
                <div className="mobile-brand brand-lockup">
                  <span className="brand-mark"><i /><i /><i /><i /></span>
                  <span>tyox</span>
                </div>
                <p className="eyebrow">GET STARTED</p>
                <h2>Welcome to your workspace</h2>
                <p>Sign in or create an account to continue.</p>
              </div>
              <form onSubmit={(event) => { event.preventDefault(); void authenticate("login"); }} className="auth-form">
                <label className="field-label" htmlFor="username">Username</label>
                <Input id="username" aria-label="Username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your username" autoComplete="username" className="dark-input" />
                <label className="field-label" htmlFor="password">Password</label>
                <Input id="password" aria-label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" className="dark-input" />
                {error && <p role="alert" className="inline-error">{error}</p>}
                <Button type="submit" disabled={busy || !username.trim() || !password} className="primary-action">
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
                <div className="auth-divider"><span>New to Tyox?</span></div>
                <Button type="button" variant="outline" disabled={busy || !username.trim() || !password} onClick={() => void authenticate("signup")} className="secondary-action">
                  Create an account
                </Button>
              </form>
            </div>
            <p className="auth-legal">A focused space to build, test, and refine your ideas.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="dark app-shell">
      <aside className="project-sidebar">
        <a className="brand-lockup sidebar-brand" href="#workspace" aria-label="Tyox home">
          <span className="brand-mark"><i /><i /><i /><i /></span>
          <span>tyox</span>
          <span className="brand-beta">BETA</span>
        </a>

        <Button type="button" className="new-project-button" onClick={() => setShowCreateProject((show) => !show)}>
          <Icon name="plus" size={17} /> New project
        </Button>

        {showCreateProject && (
          <form onSubmit={(event) => void createProject(event)} className="create-project-form">
            <label className="field-label" htmlFor="project-title">Project name</label>
            <Input id="project-title" value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="My new app" aria-label="New project title" className="dark-input" autoFocus />
            <label className="field-label" htmlFor="initial-prompt">What are you building?</label>
            <Textarea id="initial-prompt" value={initialPrompt} onChange={(event) => setInitialPrompt(event.target.value)} placeholder="A simple task tracker with…" aria-label="First task" rows={3} className="dark-input create-prompt" />
            <div className="create-project-actions">
              <button type="button" className="text-button" onClick={() => setShowCreateProject(false)}>Cancel</button>
              <Button type="submit" disabled={busy || !projectTitle.trim()} className="small-primary">{busy ? "Creating…" : "Create"}</Button>
            </div>
          </form>
        )}

        <div className="sidebar-section-label"><span>PROJECTS</span><span>{projects.length}</span></div>
        <nav className="project-list" aria-label="Projects">
          {projects.map((project) => (
            <button key={project.id} type="button" className={`project-link ${project.id === projectId ? "selected" : ""}`} onClick={() => void selectProject(project.id)} disabled={busy} aria-current={project.id === projectId ? "page" : undefined}>
              <span className="project-icon"><Icon name="folder" size={16} /></span>
              <span className="project-link-text"><span className="project-link-title">{project.title}</span><span className="project-link-subtitle">React workspace</span></span>
              {project.id === projectId && <span className="selected-indicator" />}
            </button>
          ))}
          {projects.length === 0 && <p className="sidebar-empty">Your projects will show up here.</p>}
        </nav>

        <div className="sidebar-bottom">
          <div className="account-avatar">{account.username.slice(0, 1).toUpperCase()}</div>
          <div className="account-summary"><strong>{account.username}</strong><span>Personal workspace</span></div>
          <Button type="button" variant="ghost" className="sign-out-button" aria-label="Sign out" title="Sign out" onClick={() => {
            setAccount(null); setProjectId(""); setProjects([]); setMessages([]); setTodos([]); setPending(null); setPreviewUrl(""); setError(""); setStatus("");
          }}>Sign out</Button>
        </div>
      </aside>

      <section id="workspace" className="workspace-area">
        <header className="workspace-header">
          <div className="workspace-breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{projects.find((project) => project.id === projectId)?.title ?? "Your projects"}</strong></div>
          <nav className="view-switcher" aria-label="Workspace view">
            <button type="button" className={activeView === "chat" ? "view-tab active" : "view-tab"} onClick={() => setActiveView("chat")}><Icon name="message" size={16} /> Chat</button>
            <button type="button" className={activeView === "preview" ? "view-tab active" : "view-tab"} onClick={() => setActiveView("preview")} disabled={!previewUrl}><Icon name="monitor" size={16} /> Preview</button>
          </nav>
          <div className="workspace-header-right"><span className="secure-badge"><span className={previewUrl ? "online-dot" : "idle-dot"} />{previewUrl ? "Preview online" : "Ready to build"}</span></div>
        </header>

        {error && <div role="alert" className="workspace-error"><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}

        {!projectId ? (
          <main className="welcome-workspace">
            <div className="welcome-content">
              <div className="welcome-orb"><Icon name="spark" size={26} /></div>
              <p className="eyebrow">A LITTLE HELP FROM AI</p>
              <h1>What will you<br /><span>make today?</span></h1>
              <p>Start a project and turn a rough idea into a working React app. Your code and live preview stay together in one workspace.</p>
              <Button type="button" className="welcome-button" onClick={() => setShowCreateProject(true)}><Icon name="plus" size={17} /> Start a project</Button>
              <div className="welcome-features"><span><Icon name="spark" size={15} /> AI-assisted coding</span><span><Icon name="monitor" size={15} /> Live preview</span><span><Icon name="folder" size={15} /> Saved workspaces</span></div>
            </div>
          </main>
        ) : (
          <main className="workspace-body" data-view={activeView}>
            <section className="chat-panel" aria-label="Project conversation">
              <div className="conversation-scroll" aria-live="polite">
                {messages.length === 0 ? (
                  <div className="conversation-empty">
                    <div className="empty-spark"><Icon name="spark" size={22} /></div>
                    <h1>What should we build?</h1>
                    <p>Describe a feature, ask a question, or make a change to your app.</p>
                    <div className="prompt-suggestions">
                      {["Build a clean landing page", "Add a dark theme", "Make the layout responsive"].map((suggestion) => (
                        <button type="button" key={suggestion} onClick={() => setDraft(suggestion)}>{suggestion}<span>↗</span></button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="message-list">
                    {messages.map((message, index) => (
                      <article key={`${index}-${message.role}`} className={`chat-message ${message.role}`}>
                        <div className={`message-avatar ${message.role === "assistant" ? "assistant-avatar" : "user-avatar"}`}>{message.role === "assistant" ? <span className="brand-mark mini"><i /><i /><i /><i /></span> : account.username.slice(0, 1).toUpperCase()}</div>
                        <div className="message-body"><div className="message-author">{message.role === "assistant" ? "Tyox" : "You"}</div><div className="message-content">{message.content}</div></div>
                      </article>
                    ))}
                    {busy && <div role="status" className="agent-status"><span className="status-spinner" /><span>{status || "Working on your request…"}</span></div>}
                  </div>
                )}
              </div>

              {todos.length > 0 && (
                <details className="task-drawer">
                  <summary><span><Icon name="folder" size={15} /> Project tasks</span><span>{todos.filter((todo) => todo.completed).length}/{todos.length} complete</span></summary>
                  <ol>{todos.map((todo) => <li key={todo.id} className={todo.completed ? "completed" : ""}><span>{todo.completed ? "✓" : "○"}</span><div><strong>{todo.title}</strong>{todo.description && <small>{todo.description}</small>}</div></li>)}</ol>
                </details>
              )}

              {pending && <div className="question-notice"><span className="question-icon">?</span><span>The agent needs a little more information to continue.</span></div>}
              <form onSubmit={submitMessage} className="message-composer">
                <label className="sr-only" htmlFor="message">{pending ? "Reply to the agent" : "What should the agent do?"}</label>
                <Textarea id="message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={pending ? "Type your answer…" : "Ask Tyox to make a change…"} rows={3} disabled={busy} className="composer-textarea" />
                <div className="composer-footer"><span>{pending ? "Your reply continues the current task" : "Describe the change you want to see"}</span><Button type="submit" disabled={busy || !draft.trim()} className="send-button" aria-label={pending ? "Send reply" : "Send task"}>{busy ? <span className="status-spinner" /> : <Icon name="send" size={16} />}</Button></div>
              </form>
              <p className="composer-note">Tyox can make mistakes. Review generated changes before using them.</p>
            </section>

            <section className="preview-panel" aria-label="Generated app preview">
              <header className="preview-toolbar">
                <div><span className="preview-title">Preview</span><span className="preview-live"><span className={previewUrl ? "online-dot" : "idle-dot"} />{previewUrl ? "Live" : "Waiting"}</span></div>
                <div className="preview-actions">
                  <button type="button" className="icon-action" onClick={() => setPreviewVersion((version) => version + 1)} disabled={!previewUrl} aria-label="Refresh preview"><Icon name="refresh" size={16} /></button>
                  {previewUrl && <a className="icon-action" href={previewUrl} target="_blank" rel="noreferrer" aria-label="Open preview in new tab"><Icon name="external" size={16} /></a>}
                </div>
              </header>
              {previewUrl ? (
                <iframe key={previewVersion} title="Generated React app preview" src={previewUrl} sandbox="allow-scripts allow-forms allow-same-origin" className="preview-frame" />
              ) : (
                <div className="preview-empty">
                  <div className="preview-window-art"><div className="mock-window-bar"><i /><i /><i /><span /></div><div className="mock-window-content"><div className="mock-sidebar" /><div className="mock-page"><span /><span /><span /><div /></div></div></div>
                  <div className="preview-empty-copy"><h2>Your app will appear here</h2><p>Send your first request and Tyox will build a preview you can interact with.</p></div>
                </div>
              )}
              <footer className="preview-footer"><span><span className={previewUrl ? "online-dot" : "idle-dot"} />{previewUrl ? "Preview server running in E2B" : "No preview running yet"}</span><span>React · Vite</span></footer>
            </section>
          </main>
        )}
      </section>
    </div>
  );
}
