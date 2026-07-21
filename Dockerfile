# ── backend build stage ───────────────────────────────────────────────────────
FROM node:26-alpine AS build
WORKDIR /app
# corepack is no longer bundled in the Node 26 images — install it explicitly.
RUN npm install -g corepack@latest && corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
RUN pnpm run build

# ── Mini App build stage (separate pnpm package) ──────────────────────────────
FROM node:26-alpine AS miniapp-build
WORKDIR /app/mini-app
# corepack is no longer bundled in the Node 26 images — install it explicitly.
RUN npm install -g corepack@latest && corepack enable
COPY mini-app/package.json mini-app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY mini-app/ ./
RUN pnpm run build

# ── runtime stage (shared by app + worker) ────────────────────────────────────
FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# corepack is no longer bundled in the Node 26 images — install it explicitly.
RUN npm install -g corepack@latest && corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
# Mini App static build, served by Fastify when SERVE_MINI_APP=true.
COPY --from=miniapp-build /app/mini-app/dist ./mini-app/dist

# Non-root user for the running process.
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
# Health check hits the Fastify /health route (includes queue connectivity).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1

# Default entrypoint is the app; compose overrides command for the worker.
CMD ["node", "dist/server.js"]
