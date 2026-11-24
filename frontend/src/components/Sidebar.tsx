import { useState, type FormEvent } from "react";
import type { Account, Project } from "../types";

type Props = {
  account: Account;
  projects: Project[];
  selectedId: string;
  busy: boolean;
  showCreateForm: boolean;
  setShowCreateForm: (show: boolean) => void;
  onSelect: (projectId: string) => void;
  onCreate: (title: string, prompt: string) => void;
  onSignOut: () => void;
};

export function Sidebar({ account, projects, selectedId, busy, showCreateForm, setShowCreateForm, onSelect, onCreate, onSignOut }: Props) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCreate(title.trim(), prompt.trim());
    setTitle("");
    setPrompt("");
  };

  return (
    <aside className="md:w-72 flex flex-col gap-4 border-b border-line bg-cream p-4 text-ink/80 md:border-b-0 md:border-r">
      <h1 className="text-2xl font-bold tracking-tight text-ink">tyox</h1>

      <button type="button" className="rounded-lg bg-ink py-2 font-medium text-offwhite hover:bg-ink/85" onClick={() => setShowCreateForm(!showCreateForm)}>
        + New project
      </button>

      {showCreateForm && (
        <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl border border-line bg-offwhite p-3 text-sm">
          <label htmlFor="project-title">Project name</label>
          <input id="project-title" className="rounded-lg border border-line bg-cream px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-blue-500/50" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
          <label htmlFor="initial-prompt">What do you want to build?</label>
          <textarea id="initial-prompt" className="rounded-lg border border-line bg-cream px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-blue-500/50" rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="px-3 py-1.5 hover:text-ink" onClick={() => setShowCreateForm(false)}>Cancel</button>
            <button type="submit" className="rounded-lg bg-ink px-3 py-1.5 font-medium text-offwhite hover:bg-ink/85 disabled:opacity-50" disabled={busy || !title.trim() || !prompt.trim()}>
              {busy ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      )}

      <nav className="flex-1 flex flex-col gap-1 overflow-y-auto">
        <p className="px-3 pb-1 text-xs font-semibold tracking-wider text-ink/40">PROJECTS</p>
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            disabled={busy}
            className={`truncate rounded-lg px-3 py-2 text-left ${project.id === selectedId ? "bg-line text-ink" : "hover:bg-ink/5"}`}
            onClick={() => onSelect(project.id)}
          >
            {project.title}
          </button>
        ))}
        {projects.length === 0 && <p className="px-3 text-sm text-muted">No projects yet.</p>}
      </nav>

      <div className="flex items-center gap-3 border-t border-line pt-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-line font-medium text-ink/80">
          {account.username.charAt(0).toUpperCase()}
        </span>
        <span className="flex-1 truncate text-sm">{account.username}</span>
        <button type="button" className="text-sm text-muted hover:text-ink disabled:opacity-50" disabled={busy} onClick={onSignOut}>Sign out</button>
      </div>
    </aside>
  );
}
