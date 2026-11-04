import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import type { NextFunction, Request, Response } from "express";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";

const tracer = trace.getTracer("tyox-agent");
let sdk: NodeSDK | undefined;

export function startTelemetry() {
  if (process.env.OTEL_SDK_DISABLED === "true") return;

  const hasOtlpEndpoint = Boolean(
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  );
  if (!hasOtlpEndpoint && process.env.NODE_ENV === "production") {
    console.warn("OpenTelemetry is disabled: configure OTEL_EXPORTER_OTLP_ENDPOINT to export traces.");
    return;
  }

  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || "tyox-agent",
    traceExporter: hasOtlpEndpoint ? new OTLPTraceExporter() : new ConsoleSpanExporter(),
  });
  sdk.start();
}

export async function shutdownTelemetry() {
  await sdk?.shutdown();
}

export function tracingMiddleware(req: Request, res: Response, next: NextFunction) {
  const carrier = req.headers as Record<string, string | undefined>;
  const parentContext = propagation.extract(ROOT_CONTEXT, carrier);
  const span = tracer.startSpan(`${req.method} request`, {
    kind: SpanKind.SERVER,
    attributes: { "http.request.method": req.method },
  }, parentContext);
  const requestContext = trace.setSpan(parentContext, span);
  let ended = false;

  const finish = (clientDisconnected = false) => {
    if (ended) return;
    ended = true;

    const route = req.route?.path;
    if (route) {
      const routeTemplate = `${req.baseUrl}${route}`;
      span.updateName(`${req.method} ${routeTemplate}`);
      span.setAttribute("http.route", routeTemplate);
    }
    span.setAttribute("http.response.status_code", res.statusCode);
    if (clientDisconnected) span.setAttribute("http.client_disconnected", true);
    if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  };

  res.once("finish", () => finish());
  res.once("close", () => {
    if (!res.writableEnded) finish(true);
  });

  context.with(requestContext, next);
}

export async function withSpan<T>(name: string, attributes: Attributes, run: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await run(span);
    } catch (error) {
      span.setAttribute("error.type", error instanceof Error ? error.name : "unknown");
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
