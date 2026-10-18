# Deploy Tyox on Railway

Tyox runs as three Railway services built from the repository root. In each service's settings, set the root directory to `/` and select its Dockerfile:

| Railway service | Dockerfile | Public access |
| --- | --- | --- |
| `frontend` | `deploy/frontend.Dockerfile` | Generate a domain |
| `backend` | `deploy/backend.Dockerfile` | Generate a domain |
| `agent` | `deploy/agent.Dockerfile` | Private only |

Add a Railway PostgreSQL service. Before starting the application services, apply [`../db/migrations/0001_initial.sql`](../db/migrations/0001_initial.sql) to its empty database using Railway's database query tool or `psql`. The repository currently has no migration runner, so this initial SQL is a one-time setup for a new database.

Set these variables in Railway. Use Railway reference variables for Postgres so the connection string stays in sync.

| Service | Variables |
| --- | --- |
| `backend` | `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `AGENT_ORIGIN=http://agent.railway.internal:3001`, `FRONTEND_ORIGIN=https://<frontend-domain>`, `PORT=3000` |
| `agent` | `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `GEMINI_API_KEY`, `E2B_API_KEY`, `PORT=3001`, `GEMINI_MODEL` (optional) |
| `frontend` | `TYOX_API_URL=https://<backend-domain>`; Railway supplies `PORT` |

For durable project files after E2B replaces an expired sandbox, also set on `agent`: `S3_BUCKET`, `AWS_REGION`, `S3_PREFIX` (optional), and AWS credentials with access to that bucket. Keep the bucket private and grant only the required object access for Tyox's project prefix. Without S3, generated source can be lost when its E2B sandbox expires.

Recommended order: create Postgres and run the SQL; deploy `agent`; deploy `backend`; generate a public domain for `backend`; set that URL in `frontend.TYOX_API_URL` and the frontend domain in `backend.FRONTEND_ORIGIN`; then deploy `frontend` and generate its public domain. If you change a variable after a service is deployed, redeploy that service.

The current login is a local-development flow, not a production authentication system. Treat this deployment as a portfolio demo with no private user data. Do not use real user passwords or sensitive project content.
