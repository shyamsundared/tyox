# Backend

The backend owns project and conversation endpoints, writes chat history to PostgreSQL, and relays the agent's server-sent event stream to the browser.

From this directory:

```sh
bun install
bun run index.ts
```

It listens on `PORT` (3000 by default). Set `FRONTEND_ORIGIN` to the frontend's origin and `AGENT_ORIGIN` to the agent service's base URL. Locally, the agent defaults to `http://localhost:3001`.

Set `JWT_SECRET` to a random secret in production (at least 32 random bytes, kept private; for example, generate one with `openssl rand -base64 32`). Signup and login return a 24-hour HS256 bearer token. Send it as `Authorization: Bearer <token>` on project, conversation, and todo requests. For local development, the backend has a development-only fallback secret; never use that fallback in production.

Set the same random `AGENT_API_KEY` (at least 32 bytes) on the backend and agent services in production. The backend sends it only on its server-to-server requests; the agent rejects direct unauthenticated calls. Locally both services use the same development-only fallback value.

Tyox exports OpenTelemetry traces. Locally, traces print to this service's terminal unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. In Railway, configure that variable on both backend and agent with your OTLP/HTTP base URL, then set `OTEL_SERVICE_NAME=tyox-backend` here and `OTEL_SERVICE_NAME=tyox-agent` on the agent. The OTLP exporter reads `OTEL_EXPORTER_OTLP_HEADERS` if your collector needs credentials. Set `OTEL_SDK_DISABLED=true` to disable tracing. Trace context is forwarded on backend-to-agent requests, so both services' spans appear in one trace. Tyox uses explicit instrumentation because its services run on Bun; Node.js auto-instrumentation is not enabled.
