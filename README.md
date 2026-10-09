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
- The frontend uses `http://localhost:3000` unless `window.TYOX_API_URL` is set.
- `FRONTEND_ORIGIN` is optional; the backend defaults it to `http://localhost:3002`.

Keep these `.env` files private. Never commit real keys or database credentials.

## How a request moves through the app

1. The React frontend sends a task to the Express backend.
2. When a project is created, the backend asks the agent to prepare its E2B workspace with a Vite + React + TypeScript starter, install its packages, and start a preview. The new project's starter page appears immediately.
3. The backend saves the user message and forwards the request to the agent.
4. The agent calls Gemini and carries out requested edits to the React source in E2B.
5. When it finishes, the agent starts Vite in E2B and emits a preview URL. The frontend displays that URL in its App preview view; the Chat view remains available for follow-up requests.
6. Question, progress, preview, completion, and error events use the same callback. Their shared client-facing shapes live in `shared/agent-events.ts`; the backend relays events to the frontend over server-sent events.
7. The backend stores the conversation and task list in PostgreSQL.

The agent's file and shell tools use one E2B sandbox per project. Sandbox metadata ties it back to the project, so the agent can reconnect after its own process restarts. Workspaces are created on demand and currently have a 30-minute idle timeout (refreshed when used). E2B holds the files for now; they are not yet synchronized to S3, so source files are not durable after the sandbox expires or is deleted. The agent's Gemini key stays in the agent process and is not passed into the sandbox.

## Project notes

- `prac/` is a personal practice area and is not part of the app.
- `backend/projects/` contains local generated projects and is ignored by Git.
- `Error_learning.md` records development errors and what they taught me.
- The current login flow is for local development; it does not create a persistent authenticated session.
