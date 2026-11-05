export type Account = { id: string; username: string };

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type PendingQuestion = { conversation_id: string; call_id: string; question: string };

export type Project = {
  id: string;
  title: string;
  initialPrompt: string;
  previewUrl?: string;
  workspaceError?: string;
};

export type HistoryEntry = {
  id: string;
  convos: { From: "USER" | "ASSISTANT"; Content: string }[];
  pendingQuestion: PendingQuestion | null;
};
