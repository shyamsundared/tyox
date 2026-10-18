-- Initial schema for a new Tyox PostgreSQL database.

CREATE TABLE "user" (
  "id" text PRIMARY KEY,
  "username" text NOT NULL UNIQUE,
  "password" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "project" (
  "id" text PRIMARY KEY,
  "userid" text NOT NULL REFERENCES "user" ("id"),
  "title" text NOT NULL,
  "initialPrompt" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "project_userid_idx" ON "project" ("userid");

CREATE TABLE "conversationHistory" (
  "id" text PRIMARY KEY,
  "projectId" text NOT NULL REFERENCES "project" ("id"),
  "agentState" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "conversationHistory_projectId_idx" ON "conversationHistory" ("projectId");

CREATE TABLE "conversation" (
  "id" text PRIMARY KEY,
  "conversation_id" text NOT NULL REFERENCES "conversationHistory" ("id"),
  "From" text NOT NULL CHECK ("From" IN ('USER', 'ASSISTANT')),
  "Content" text NOT NULL,
  "ConversationType" text NOT NULL CHECK ("ConversationType" IN ('TOOL_CALL', 'TEXT_MESSAGE')),
  "toolcall" text CHECK ("toolcall" IN ('READ_FILE', 'WRITE_FILE', 'DELETE_FILE', 'UPDATE_FILE', 'QNA', 'CREATE_TODOS')),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "conversation_conversation_id_idx" ON "conversation" ("conversation_id");

CREATE TABLE "todo" (
  "id" text PRIMARY KEY,
  "projectId" text NOT NULL REFERENCES "project" ("id"),
  "title" text NOT NULL,
  "description" text,
  "completed" boolean NOT NULL DEFAULT false,
  "position" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "todo_projectId_idx" ON "todo" ("projectId");
