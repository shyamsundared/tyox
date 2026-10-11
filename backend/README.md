# Backend

The backend owns project and conversation endpoints, writes chat history to PostgreSQL, and relays the agent's server-sent event stream to the browser.

From this directory:

```sh
bun install
bun run index.ts
```

It listens on `PORT` (3000 by default). Set `FRONTEND_ORIGIN` to the frontend's origin and `AGENT_ORIGIN` to the agent service's base URL. Locally, the agent defaults to `http://localhost:3001`.
