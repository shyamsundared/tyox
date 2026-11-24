import { useState } from "react";
import { postJson, saveSession } from "../api";
import type { Account } from "../types";

type Props = {
  notice: string;
  onLogin: (account: Account) => void;
};

export function LoginPage({ notice, onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = !busy && username.trim() !== "" && password !== "";

  const submit = async (action: "login" | "signup") => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const { token, ...account } = await postJson<Account & { token: string }>(`/api/v1/${action}`, {
        username: username.trim(),
        password,
      });
      saveSession(token, account);
      onLogin(account);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-cream p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-ink">tyox</h1>
          <p className="mt-2 text-muted">Describe an app. Get a live preview.</p>
        </div>

        <form
          className="flex flex-col gap-4 rounded-2xl border border-line bg-offwhite p-8 shadow-sm"
          onSubmit={(event) => { event.preventDefault(); void submit("login"); }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="username" className="text-sm font-medium text-ink/80">Username</label>
            <input id="username" className="rounded-lg border border-line bg-cream px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-blue-500/50" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium text-ink/80">Password</label>
            <input id="password" className="rounded-lg border border-line bg-cream px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-blue-500/50" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </div>

          {(error || notice) && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error || notice}</p>}

          <button type="submit" disabled={!canSubmit} className="rounded-lg bg-ink py-2 font-medium text-offwhite hover:bg-ink/85 disabled:opacity-50">
            {busy ? "Please wait..." : "Sign in"}
          </button>
          <button type="button" disabled={!canSubmit} className="rounded-lg border border-ink/40 py-2 font-medium text-ink hover:bg-ink/5 disabled:opacity-50" onClick={() => void submit("signup")}>
            Create account
          </button>
        </form>
      </div>
    </main>
  );
}
