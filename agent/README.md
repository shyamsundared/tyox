# Agent

The agent sends requests to Gemini and runs its available tools: reading and writing project files, running shell commands, and creating todos. `output.ts` contains the tool loop; `functions.ts` contains the tool implementations.

From this directory:

```sh
bun install
bun run index.ts
```

It listens on port 3001. Bun loads `GEMINI_API_KEY` and `E2B_API_KEY` from `agent/.env`. The agent also loads `DATABASE_URL` from `db/.env` through the shared database module.

Each project's file and shell tools connect to an E2B sandbox. Commands start in `/tmp/tyox-project`, are limited to two minutes, and run in the isolated sandbox rather than on the host. Internet access is enabled so generated projects can install packages; do not pass host secrets into the sandbox. The sandbox currently holds workspace files only until E2B expires or deletes it. S3 synchronization is a future step for durable storage.

Creating a project initializes a Vite + React + TypeScript starter with Tailwind CSS in its E2B workspace and installs the starter packages. The agent's tools are directed to edit `src/App.tsx` and `src/index.css`, keeping the app runnable for the preview.

After the agent finishes a request, `preview.ts` installs dependencies when needed, starts the project's `dev` or `start` script, waits for the app to answer on port 4173, and returns its E2B URL. The agent streams that URL to the frontend, which renders it in an iframe. Vite and Next.js receive their respective host and port flags; other scripts can use the standard `HOST` and `PORT` environment variables.
