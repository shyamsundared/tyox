# Tyox

Tyox is a local project assistant. You create a project, describe a task, and the agent can read or write files, run commands, ask a follow-up question, and save a task list. The chat and project history are stored in PostgreSQL.

## Run it locally

The app has three server processes and a separate database package. Install each package once:

```sh
cd db && bun install
cd ../agent && bun install
cd ../backend && bun install
cd ../frontend && bun install
```

Then start each server in its own terminal from the repository root:

```sh
bun run dev:agent
```

```sh
bun run dev:backend
```

```sh
bun run dev:frontend
```

Open the frontend URL printed in the last terminal (normally `http://localhost:3002`). The backend listens on port 3000 and the agent listens on port 3001.

## Local configuration

- Put `DATABASE_URL` in `db/.env`.
- Put `GEMINI_API_KEY` and `E2B_API_KEY` in `agent/.env`.
- The agent defaults to the free-tier `gemini-3.1-flash-lite` model. Set `GEMINI_MODEL` in `agent/.env` to use another Gemini model available to your API project.
- To persist project source between E2B sandboxes, set `S3_BUCKET` and `AWS_REGION` in `agent/.env`, plus AWS credentials available to the AWS SDK (for local use, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`). `S3_PREFIX` is optional and defaults to `tyox/projects`.
- The frontend uses `http://localhost:3000` unless `window.TYOX_API_URL` is set.
- `FRONTEND_ORIGIN` is optional; the backend defaults it to `http://localhost:3002`.

Keep these `.env` files private. Never commit real keys or database credentials.

The S3 bucket should remain private. The agent needs `s3:GetObject` and `s3:PutObject` for `tyox/projects/*` (or your configured prefix). Tyox stores a compressed source snapshot at `{S3_PREFIX}/{projectId}/workspace.tar.gz`; it excludes `node_modules`, `.git`, build output, and `.env` files. Enable S3 bucket versioning if you want the bucket to retain older snapshots; S3 itself does not create Git commits or diffs.

## How a request moves through the app

1. The React frontend sends a task to the Express backend.
2. When a project is created, the backend asks the agent to prepare its E2B workspace with a Vite + React + TypeScript starter, install its packages, and start a preview. The new project's starter page appears immediately.
3. The backend saves the user message and forwards the request to the agent.
4. The agent calls Gemini and carries out requested edits to the React source in E2B.
5. Before completing a coding request, the agent derives user-visible acceptance criteria, writes or updates React Testing Library tests, and runs the test suite. Tyox then runs the production build and starts or recovers the preview. Test or build failures are returned to the agent for up to two repair attempts.
6. When it finishes, the agent starts Vite in E2B and emits a preview URL. The frontend displays that URL in its App preview view; the Chat view remains available for follow-up requests.
7. Question, progress, preview, completion, and error events use the same callback. Their shared client-facing shapes live in `shared/agent-events.ts`; the backend relays events to the frontend over server-sent events.
8. The backend stores the conversation and task list in PostgreSQL.

The agent's file and shell tools use one E2B sandbox per project. Sandbox metadata ties it back to the project, so the agent can reconnect after its own process restarts. Workspaces are created on demand and currently have a 30-minute idle timeout (refreshed when used). E2B holds the files for now; they are not yet synchronized to S3, so source files are not durable after the sandbox expires or is deleted. The agent's Gemini key stays in the agent process and is not passed into the sandbox.

## Project notes

- `prac/` is a personal practice area and is not part of the app.
- `backend/projects/` contains local generated projects and is ignored by Git.
- `Error_learning.md` records development errors and what they taught me.
- The current login flow is for local development; it does not create a persistent authenticated session.
