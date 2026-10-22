-- Durable record for one request to the agent. Worker execution is added later.

CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED');

CREATE TABLE "agentRun" (
  "id" text PRIMARY KEY,
  "projectId" text NOT NULL REFERENCES "project" ("id"),
  "conversationId" text NOT NULL REFERENCES "conversationHistory" ("id"),
  "prompt" text NOT NULL,
  "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" integer NOT NULL DEFAULT 0,
  "error" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "startedAt" timestamptz,
  "finishedAt" timestamptz
);

CREATE INDEX "agentRun_projectId_status_idx" ON "agentRun" ("projectId", "status");
CREATE INDEX "agentRun_conversationId_idx" ON "agentRun" ("conversationId");
