# Agent

The agent sends requests to Gemini and runs its available tools: reading and writing project files, running shell commands, and creating todos. `output.ts` contains the tool loop; `functions.ts` contains the tool implementations.

From this directory:

```sh
bun install
bun run index.ts
```

It listens on port 3001. Bun loads `GEMINI_API_KEY` from `agent/.env`. The agent also loads `DATABASE_URL` from `db/.env` through the shared database module.

This process runs locally with your user permissions. Its shell tool starts in a project folder, but the shell itself is not isolated from the rest of the machine.
