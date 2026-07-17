# ── build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
RUN npm run build

# ── runtime stage (shared by app + worker) ────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations

# Non-root user for the running process.
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
# Health check hits the Fastify /health route (includes queue connectivity).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1

# Default entrypoint is the app; compose overrides command for the worker.
CMD ["node", "dist/server.js"]
