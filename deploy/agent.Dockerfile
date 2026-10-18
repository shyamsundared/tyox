FROM oven/bun:1.3.14

WORKDIR /app/db
COPY db/package.json db/bun.lock ./
RUN bun install --frozen-lockfile
COPY db/ ./

WORKDIR /app/agent
COPY agent/package.json agent/bun.lock ./
RUN bun install --frozen-lockfile
COPY agent/ ./
COPY shared/ /app/shared/

ENV NODE_ENV=production
EXPOSE 3001
CMD ["bun", "run", "index.ts"]
