import { randomUUID } from "node:crypto";
import { trace } from "@opentelemetry/api";

export type CheckStatus = "not_run" | "passed" | "failed" | "skipped";

export type ValidationMetrics = {
    tests: CheckStatus;
    build: CheckStatus;
    browser: CheckStatus;
    result: "passed" | "failed";
    durationMs: number;
};

export type PreviewMetrics = {
    result: "ready" | "failed";
    durationMs: number;
};

export type AgentRunMetrics = {
    runId: string;
    conversationId: string;
    projectId: string;
    startedAt: number;
    outcome: "running" | "completed" | "waiting_for_user" | "validation_failed" | "failed";
    errorType?: string;
    durationMs?: number;
    modelTurns: number;
    modelCycleDurationMs: number;
    toolCalls: number;
    failedToolCalls: number;
    repairAttempts: number;
    inputTokens: number | null;
    outputTokens: number | null;
    validationRuns: ValidationMetrics[];
    previewAttempts: PreviewMetrics[];
};

export function createAgentRunMetrics(conversationId: string, projectId: string): AgentRunMetrics {
    return {
        runId: randomUUID(),
        conversationId,
        projectId,
        startedAt: Date.now(),
        outcome: "running",
        modelTurns: 0,
        modelCycleDurationMs: 0,
        toolCalls: 0,
        failedToolCalls: 0,
        repairAttempts: 0,
        inputTokens: null,
        outputTokens: null,
        validationRuns: [],
        previewAttempts: [],
    };
}

export function logAgentRunMetrics(metrics: AgentRunMetrics): void {
    metrics.durationMs = Date.now() - metrics.startedAt;
    const { startedAt: _startedAt, ...summary } = metrics;
    const spanContext = trace.getActiveSpan()?.spanContext();
    console.info(JSON.stringify({
        event: "agent_run_summary",
        traceId: spanContext?.traceId,
        spanId: spanContext?.spanId,
        ...summary,
    }));
}
