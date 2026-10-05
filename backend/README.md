# Backend

The backend owns project and conversation endpoints, writes chat history to PostgreSQL, and relays the agent's server-sent event stream to the browser.

From this directory:

```sh
bun install
bun run index.ts
```

It listens on port 3000. Set `FRONTEND_ORIGIN` if the frontend is running at a different origin. The agent URL is currently `http://localhost:3001` in `index.ts`.
