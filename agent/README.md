# Agent

The agent sends requests to Gemini and runs tools for reading files, writing files, running shell commands, and asking the user questions. `agent-loop.ts` contains the tool loop. Tool definitions and execution live in `tools/`, while E2B setup, preview, validation, and S3 snapshots live in `workspace/`.

From this directory:

```sh
bun install
bun run server.ts
```

It listens on port 3001. Bun loads `GEMINI_API_KEY` and `E2B_API_KEY` from `agent/.env`. The agent also loads `DATABASE_URL` from `db/.env` through the shared database module. Set `AGENT_API_KEY` to the same private value configured on the backend in production (at least 32 bytes); the backend uses this key to authenticate its internal agent requests. Never expose it to the frontend.

Set `S3_BUCKET` and `AWS_REGION` in `agent/.env` to enable durable source snapshots. The AWS SDK uses its standard credential chain (`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` locally, or an AWS role in hosted environments). `S3_PREFIX` is optional and defaults to `tyox/projects`. When a new E2B workspace is created, Tyox restores the project's latest `workspace.tar.gz`; after generation it uploads a new archive before validation. Archives exclude `node_modules`, `.git`, build output, and `.env` files. Without `S3_BUCKET`, the app continues to work but warns that source remains only in the active sandbox.

Tyox emits OpenTelemetry traces from the agent. For local development, spans are written to the agent terminal unless an OTLP endpoint is configured. In Railway, set `OTEL_EXPORTER_OTLP_ENDPOINT` on both the `tyox-agent` and `tyox-backend` services to your OTLP/HTTP base URL (usually port 4318); set `OTEL_SERVICE_NAME` to `tyox-agent` on this service and `tyox-backend` on the backend. The exporter reads standard `OTEL_EXPORTER_OTLP_HEADERS` credentials when your collector requires them. Set `OTEL_SDK_DISABLED=true` to turn tracing off. Traces cover HTTP requests, agent runs, Gemini calls, workspace validation, previews, and S3 snapshots. Prompts and generated source are not added as span attributes. Tyox runs on Bun, so the initial instrumentation is explicit; it does not rely on Node.js auto-instrumentation.

For local S3-compatible storage, copy `agent/.env.example` to `agent/.env`, then run these commands from the repository root:

```sh
docker compose --env-file agent/.env -f compose.local-s3.yaml up -d --wait
cd agent && bun run s3:bucket
```

The local S3-compatible server is RustFS. Its S3 API is at `http://localhost:9000` and its console is at `http://localhost:9001`. It uses the same AWS SDK code as MinIO or AWS S3. For authentication, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in the agent must match `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY` in the container. These credentials are for local development only. The bucket command is safe to rerun if the bucket already exists. To stop the server while keeping stored objects, run `docker compose --env-file agent/.env -f compose.local-s3.yaml down`; add `-v` only when you want to delete the local bucket data too.

Each project's file and shell tools connect to an E2B sandbox. Commands start in `/tmp/tyox-project`, are limited to two minutes, and run in the isolated sandbox rather than on the host. Internet access is enabled so generated projects can install packages; do not pass host secrets into the sandbox. The sandbox holds the active workspace; source snapshots in S3 allow a replacement sandbox to restore project files. This snapshot mechanism is not a Git history and does not retain `node_modules` or generated build output.

Workspace acquisition uses two maps: one caches connected sandboxes, and the other shares an in-flight acquisition promise between requests for the same project. A failed command does not discard a healthy sandbox. A confirmed expired sandbox is reconnected or replaced on the next acquisition.

`project-runs.ts` rejects overlapping tasks for the same project with HTTP 409. The guard is acquired before initialization, generation, or loading a pending answer and released when the task settles. Other projects can run concurrently. Both the guard and cache are local to one process: keep one agent replica until a shared locking mechanism exists. SDK timeout rejection does not guarantee that a remote command or write has stopped; cancellation still needs work before strict exclusion can be promised after timeouts.

There is currently no browser heartbeat/disconnect integration. Each workspace acquisition refreshes E2B's 30-minute timeout; closing the browser does not immediately kill the sandbox. Removed lease helpers had no callers and did not implement the lifecycle previously described here. With S3 configured, a replacement sandbox restores the last snapshot; without it, sandbox expiry loses the generated source.

Creating a project initializes a Vite + React + TypeScript starter with Tailwind CSS in its E2B workspace and installs the starter packages. The agent's tools are directed to edit `src/App.tsx` and `src/index.css`, keeping the app runnable for the preview.

The starter includes Vitest, jsdom, React Testing Library, and Playwright. For a coding request, the agent should derive user-visible acceptance criteria from the request and add or update focused component tests; for browser-only behavior such as drag-and-drop, it should add a Playwright test under `e2e/`. Before Tyox publishes a completion event, it runs Vitest when installed, runs `npm run build`, starts the preview, then runs Playwright against the app on `127.0.0.1:4173`. Chromium is installed lazily in the E2B workspace when browser validation first runs. If Vitest is missing, it reports that tests were skipped and still runs the build and browser checks. If validation fails, Tyox sends the diagnostics for one focused repair and validates once more. Tests written by the agent should be reviewed; passing them is not independent proof that the app satisfies the request.

After each agent run, the agent logs one JSON `agent_run_summary` record. It includes run outcome, model turns and duration, tool success counts, unit-test/build/browser results for each validation pass, preview readiness and duration, repair attempts, and Gemini token counts when the API returns them. The record omits prompts and generated source. Detailed validation failures are logged as `project_preview_validation_failed`; other agent failures use `agent_run_failed`. These logs include an error reference shown to the user, allowing an operator to find the corresponding details in the agent service logs. In Railway, open the `tyox-agent` service's Deployments or Observability logs and search for the event name or reference. Backend-to-agent relay failures are logged by the `tyox-backend` service. The app returns a short user-facing message instead of the raw command output. For local development, filter the agent terminal output for these event names or `agent_run_summary`.

Validation also logs the E2B `sandboxId` as `project_validation_started`. The E2B CLI can show runtime logs for a sandbox with `e2b sandbox logs <sandboxID>`. For Tyox's `npm test` and `npm run build` output, use the `project_preview_validation_failed` record in Railway's `tyox-agent` logs; that output is captured by the SDK command result and is not the same as the sandbox runtime log stream.

`evals/cases.json` contains a small manual challenge set for comparing changes to the model, prompt, or recovery loop. See `evals/README.md` for the repeatable procedure. It is not automatically run in CI yet.

After unit tests and the production build pass, `workspace/preview.ts` starts the project's `dev` or `start` script, waits for the app to answer on port 4173, and returns its E2B URL. `workspace/validation.ts` then runs Playwright's browser checks against that local port in Chromium. Only after those checks pass does the agent stream the preview URL to the frontend, which renders it in an iframe. This is a focused browser smoke/E2E check, not a guarantee of full production quality. Vite and Next.js receive their respective host and port flags; other scripts can use the standard `HOST` and `PORT` environment variables.
