# pm-telegram-hub

Telegram aggregator (Bot + Mini App) over work systems — ClickUp and Wrike in
Phase 1, Jira in Phase 3. Provider events are delivered to Telegram as
notifications; tasks can be managed from chat and the Mini App. See
`docs/telegram-aggregator-spec.pdf` (v2.3) for the full specification.

**Iron rule:** the core (webhook endpoint, worker, notifier, bot, Mini App)
operates only on unified models. Provider-specific code lives exclusively
inside an adapter. A new provider = one adapter file + one registry entry.

## Architecture

```
Provider webhooks ─► POST /webhooks/:provider ─► BullMQ (Redis) ─► worker
   (signed, fast-ACK)                                   │
                                                        ▼
                       parse → enrich → match subscriptions → idempotent insert
                                                        │
                                                        ▼
                                    Notifier (rate-limited) → Telegram Bot API
```

- **Integration Service** — Fastify 5, TypeScript, Node 22. Hosts the webhook
  endpoint, the grammY bot (webhook or polling), and shared modules.
- **Worker** — separate BullMQ worker process; scales independently.
- **DB** — Supabase (PostgreSQL). Provider-agnostic schema; credentials and
  webhook secrets are AES-256-GCM encrypted at the application boundary.
- **Mini App** — React + Vite (Phase 2).

### Repository layout

```
src/
  adapters/        ProviderAdapter contract, registry, rate limiter, clickup/, wrike/
  bot/             grammY bot: commands, inline-callback actions, webhook/polling
  config/          zod-validated environment
  crypto/          AES-256-GCM + HMAC helpers
  db/              Supabase client + repositories (all scoped by user_id)
  models/          unified domain types
  notifier/        HTML templates, Telegram rate limiters, delivery
  queue/           BullMQ queue, fast-ACK webhook route, worker pipeline
  services/        connection service (verify → persist → register webhook)
  server.ts        Fastify app entrypoint (app + bot)
  worker.ts        BullMQ worker entrypoint
migrations/        SQL migrations (plain SQL; applied via `npm run migrate`)
docker/            nginx config (TLS, routing)
```

## Getting started

### Prerequisites

- Node.js 22 LTS (`.nvmrc`)
- A Telegram bot token (talk to [@BotFather](https://t.me/BotFather))
- A Supabase project (URL + service role key + the project JWT secret)
- Redis (local `redis://127.0.0.1:6379` for dev, or Docker)

### Configure

```bash
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY,
#   ENCRYPTION_KEY (openssl rand -hex 32), JWT_SECRET, APP_URL, MINIAPP_URL
```

All configuration is environment-driven (spec §9); the app fails fast on
missing/invalid values.

### Migrate

```bash
# DATABASE_URL = Supabase direct connection string (?sslmode=require)
DATABASE_URL="postgresql://postgres:...@db.xxx.supabase.co:5432/postgres?sslmode=require" npm run migrate
```

> The RLS migration (0002) references the Supabase-provided `auth.jwt()`. It must
> run against a Supabase/PostgREST database, not vanilla Postgres.

### Develop

```bash
npm install
npm run dev          # Fastify app + bot (BOT_MODE=polling by default)
npm run dev:worker   # BullMQ worker (separate terminal)
npm test             # unit tests
npm run typecheck    # tsc --noEmit
```

In polling mode the bot long-polls (no public URL needed). In production set
`BOT_MODE=webhook`; the app registers the webhook at `${APP_URL}/api/telegram`
with `secret_token` verification.

## Deploy (VPS, Docker Compose)

```bash
docker compose up -d --build   # app, worker, redis, nginx
```

nginx terminates TLS (Let's Encrypt) and routes `api.<domain>` (`/webhooks`,
`/api`, `/health`) to the app; `app.<domain>` serves the Mini App static build
(Phase 2). Edit `docker/nginx.conf` to set your domains and cert paths.

Health check: `GET /health` → `{ "ok": true, "checks": { "queue": true }, ... }`.

## Bot commands

The bot (English) covers connections/subscriptions, task management (create,
status, comment, assign, due, browse, map), and inline actions under
notifications (💪 Take, ✅ Done, 💬 Comment, ↩️ Reply).

**Full command reference — parameters and examples: [`docs/bot-commands.md`](docs/bot-commands.md)**

Quick start:

| Command | Purpose |
| --- | --- |
| `/connect <provider> <token>` | Connect a provider (token is deleted from chat) |
| `/subscribe [provider] [me]` | Subscribe this chat (`me` = only tasks assigned to you) |
| `/newtask <name> [#alias]` | Create a task |
| `/status <id> done` | Change status (keywords: done / in-progress / open / cancel) |
| `/comment <id> <text>` | Comment on a task |

Providers needing multiple credential fields (Jira) are connected via the Mini
App, not `/connect`.

## Security

- Provider credentials and webhook secrets are AES-256-GCM encrypted at rest
  (`iv:tag:ciphertext`); the key never leaves the app (`ENCRYPTION_KEY`).
- Webhook signatures verified over the **raw** request bytes (HMAC-SHA256);
  ClickUp `X-Signature`, Wrike `X-Hook-Secret` (handshake + notification), Jira
  `X-Hub-Signature`.
- `/connect` deletes the token-bearing message; the main credential path is the
  Mini App.
- Telegram updates verified via `secret_token`.
- Delivery is idempotent at the DB level (`unique(subscription_id, dedupe_key)`).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` / `dev:worker` | tsx watch for app / worker |
| `npm run build` | tsup → `dist/` |
| `npm start` / `start:worker` | run the built app / worker |
| `npm test` | vitest |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `format` | ESLint / Prettier |
| `npm run migrate` | apply SQL migrations |

## Status

Phase 1 (P0) — notifications + inline actions for ClickUp and Wrike — is
implemented. The provider-agnostic core and adapter contract are in place; Jira
(Phase 3) slots in via the §4.4 checklist without core changes. Live provider
API surfaces (exact request/response shapes) should be confirmed against the
real APIs with credentials during first integration.
