# Tyox

Tyox is a Lovable style AI app builder. You describe an app in a chat, a Gemini agent writes the React code inside an E2B sandbox, runs the tests and build, and shows you a live preview.

## Features

- Agent loop with tool calling (read file, write file, run command, ask the user a question)
- Live progress in the browser using server-sent events
- Each project gets its own E2B sandbox, so generated code never runs on the server
- The agent can stop to ask a question and continue later, even after a restart, because its state is saved in Postgres
- Generated code goes through tests, a build and a Playwright check. If they fail, the error goes back to the agent for one repair attempt
- Project files are saved to S3, so they can be restored when a sandbox expires
- JWT auth, and users can only access their own projects

## Tech stack

React, Bun, Express, PostgreSQL, Prisma, Gemini API, E2B, S3, Docker

## How it works

There are three services. See [architecture.md](architecture.md) for more detail.

- `frontend` - the chat UI and preview
- `backend` - auth, projects and chat history. Forwards agent events to the browser
- `agent` - runs the agent loop and talks to Gemini and E2B. Only the backend can call it

The main code to read is [agent/agent-loop.ts](agent/agent-loop.ts).

## Running locally

Install dependencies in each package:

```sh
bun install
cd db && bun install
cd ../agent && bun install
cd ../backend && bun install
cd ../frontend && bun install
```

Set up the env files:

- `db/.env`: `DATABASE_URL`
- `agent/.env`: `GEMINI_API_KEY`, `E2B_API_KEY`

Create the database tables:

```sh
cd db && bunx prisma db init
```

Then start each service in its own terminal from the root folder:

```sh
bun run dev:agent
bun run dev:backend
bun run dev:frontend
```

The app runs on http://localhost:3002. The backend uses port 3000 and the agent uses port 3001.

### Saving projects to S3 (optional)

Without S3, a project is lost when its sandbox expires. For local development you can run RustFS, which works like S3:

```sh
cp agent/.env.example agent/.env
docker compose --env-file agent/.env -f compose.local-s3.yaml up -d --wait
cd agent && bun run s3:bucket
```

Remember to add your Gemini and E2B keys back to `agent/.env`. To use real S3, set `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` instead.

## Tests

```sh
bun run test:backend
bun run typecheck
```

## Deployment

See [deploy/README.md](deploy/README.md) for the Railway setup.

## Known limitations

- The project lock is kept in memory, so the agent can only run as one instance
- If the agent restarts during a run, that run is lost. Only paused runs waiting for an answer survive
- There is no rate limiting yet, so it isn't ready for public users
