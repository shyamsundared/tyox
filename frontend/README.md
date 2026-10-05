# Frontend

The frontend is a React chat served by Bun. `src/AgentChat.tsx` owns the current account, project, messages, and agent stream state. Shared form controls live in `src/components/ui/`.

From this directory:

```sh
bun install
bun run dev
```

The development server uses port 3002 by default. Set `PORT` to use another port. The API defaults to `http://localhost:3000` and can be changed with `window.TYOX_API_URL`.
