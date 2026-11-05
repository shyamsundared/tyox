import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage, PendingQuestion } from "../types";

type Props = {
  className: string;
  messages: ChatMessage[];
  pending: PendingQuestion | null;
  busy: boolean;
  status: string;
  onSend: (message: string) => void;
};

export function ChatPanel({ className, messages, pending, busy, status, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // keep the newest message in view
  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages, status]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setDraft("");
    onSend(message);
  };

  return (
    <section className={`flex-col min-h-0 min-w-0 bg-zinc-50 ${className}`}>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="m-auto text-center">
            <h2 className="text-xl font-semibold text-zinc-800">What should we build?</h2>
            <p className="mt-1 text-zinc-500">Describe a feature or ask for a change.</p>
          </div>
        )}
        {messages.map((message, index) => (
          <p
            key={index}
            className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 ${message.role === "user" ? "self-end bg-orange-600 text-white" : "self-start border border-zinc-200 bg-white text-zinc-800"}`}
          >
            {message.content}
          </p>
        ))}
        {busy && (
          <div role="status" className="flex items-center gap-2 text-sm text-zinc-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-orange-600" />
            {status || "Working on it..."}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="p-4 pt-0">
        {pending && <p className="pb-2 text-sm font-medium text-orange-700">The agent is waiting for your answer.</p>}
        <div className="flex items-end gap-2 rounded-xl border border-zinc-300 bg-white p-2 focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-200">
          <label className="sr-only" htmlFor="message">Message</label>
          <textarea id="message" className="flex-1 resize-none px-2 py-1 outline-none" rows={2} disabled={busy} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={pending ? "Type your answer..." : "Ask Tyox to make a change..."} />
          <button type="submit" className="rounded-lg bg-orange-600 px-4 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-50" disabled={busy || !draft.trim()}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
