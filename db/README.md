# Database

The schema is in `schema.prisma`. `schema.json` and `schema.d.ts` are generated from it.

After changing the schema, run this from this folder:

```sh
bun run contract:emit
```

This only updates the generated files, it does not change the database.

To create the tables in a new empty database, run:

```sh
bunx prisma db init
```
