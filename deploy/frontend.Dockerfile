FROM oven/bun:1.3.14

WORKDIR /app/frontend
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
COPY shared/ /app/shared/
RUN bun run build

ENV NODE_ENV=production
EXPOSE 3002
CMD ["bun", "src/index.ts"]
