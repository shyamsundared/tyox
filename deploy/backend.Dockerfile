FROM oven/bun:1.3.14

WORKDIR /app/db
COPY db/package.json db/bun.lock ./
RUN bun install --frozen-lockfile
COPY db/ ./

WORKDIR /app/backend
COPY backend/package.json backend/bun.lock ./
RUN bun install --frozen-lockfile
COPY backend/ ./
COPY shared/ /app/shared/

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "index.ts"]
