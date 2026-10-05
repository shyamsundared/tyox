# Database

The PostgreSQL contract lives in `schema.prisma`. `schema.json` and `schema.d.ts` are generated from it and are used by the shared client in `db.ts`.

Set `DATABASE_URL` in `db/.env`. After changing the schema, run this from the `db/` directory:

```sh
bun run contract:emit
```

Contract generation updates the local client artifacts; it does not apply a database migration. The project does not yet have a versioned migration history, so don’t assume a schema change has been applied to every database just because these files were regenerated.
