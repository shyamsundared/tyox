# Database

The PostgreSQL contract lives in `schema.prisma`. `schema.json` and `schema.d.ts` are generated from it and are used by the shared client in `db.ts`. SQL changes are kept as numbered files in `migrations/` and must be applied to each database separately.

Set `DATABASE_URL` in `db/.env`. After changing the schema, run this from the `db/` directory:

```sh
bun run contract:emit
```

Contract generation updates the local client artifacts; it does not apply a database migration. For example, `0002_agent_runs.sql` creates the new `agentRun` table. Apply that SQL to the target database before deploying code that reads or writes the model. Regenerating the contract alone does not change any database.
