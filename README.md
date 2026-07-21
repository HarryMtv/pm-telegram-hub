# pm-telegram-hub

A Telegram bot + Mini App that puts your work systems in your pocket. Events
from ClickUp and Wrike (Jira is being added) — task created, status changed,
comment added — arrive as Telegram notifications, and you can act on tasks
right from the chat or the Mini App: take, complete, comment, reassign, set
due dates.

- **I want to use the bot** → [Using the bot](#using-the-bot)
- **I want to run/develop it** → [Running your own instance](#running-your-own-instance)

## Using the bot

### 1. Start

Open the bot in Telegram and send `/start`. You get a greeting and a button
that opens the **Mini App**.

### 2. Connect a provider

```
/connect clickup pk_...
```

The token is verified, stored encrypted, and the message containing it is
deleted from the chat immediately. Providers that need several credential
fields (Jira: `baseUrl`, `email`, `apiToken`) are connected from the Mini
App's **Connections** screen instead.

**Step-by-step: how to create a token and connect each provider (ClickUp,
Wrike, Jira): [`docs/connect-providers.md`](docs/connect-providers.md).**

> **🔒 Your tokens are safe.** Every API token and webhook secret you provide is
> **encrypted at rest** (AES-256-GCM) before it touches the database — the
> encryption key stays on the server and is never stored alongside your data or
> sent back to any client. The bot never displays your token again, and the
> `/connect` message carrying it is deleted from the chat as soon as it's
> verified. If a token ever leaks, revoke it in the provider's console and
> reconnect. See [Security](#security) for the technical details.

### 3. Subscribe to notifications

```
/subscribe        # all events on all your connections
/subscribe me     # only tasks assigned to you
```

From then on, matching provider events land in the chat as notifications.
Your own actions are not echoed back to you, and re-delivered webhooks never
produce duplicate messages.

### 4. Act on tasks from the chat

Notifications and `/task` cards carry inline buttons:

- 💪 **Take** — move the task to an _in progress_ status
- ✅ **Done** — move it to a _done_ status
- 💬 **Comment** — hint for `/comment <id> <text>`
- ↩️ **Reply** — under comment notifications: posts a reply that @mentions the
  original author in the provider (ClickUp)

For everything else there are commands:

```
/newtask Fix the login #inbox      # create a task (find containers with /browse, alias them with /map)
/status 869e5gd48 done             # keywords: done / in-progress / open / cancel
/comment 869e5gd48 shipping it
/assign 869e5gd48 @302663612
/due 869e5gd48 2026-08-01
```

**Full command reference with parameters and examples: [`docs/bot-commands.md`](docs/bot-commands.md)**

**How to create tokens and connect each provider (ClickUp, Wrike, Jira): [`docs/connect-providers.md`](docs/connect-providers.md)**

### 5. The Mini App

Tap the button in `/start` (or the bot's menu button) to open the Mini App:

- **Inbox** — your task feed across all connections, with a task detail view
- **Create task** — into a chosen container
- **Connections** — connect providers, including multi-field ones like Jira
- **Subscriptions** — manage which chats receive which events
- **Mappings** — alias → container shortcuts used by `/newtask`

## How it works

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
- **Mini App** — React 19 + Vite, TanStack Query, `@telegram-apps/sdk`.

**Iron rule:** the core (webhook endpoint, worker, notifier, bot, Mini App)
operates only on unified models. Provider-specific code lives exclusively
inside an adapter. A new provider = one adapter file + one registry entry.

### Repository layout

```
src/
  adapters/        ProviderAdapter contract, registry, rate limiter, clickup/, wrike/, jira/
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
migrations/        SQL migrations (plain SQL; applied via `pnpm migrate`)
docker/            nginx config (TLS, routing)
```

## Running your own instance

### Prerequisites

- Node.js 22 LTS (`.nvmrc`)
- pnpm 10 (`corepack enable`)
- A Telegram bot token (talk to [@BotFather](https://t.me/BotFather))
- A Supabase project (URL + service role key + the project JWT secret)
- Redis (local `redis://127.0.0.1:6379` for dev, or Docker)

### Configure

```bash
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY,
#   ENCRYPTION_KEY (openssl rand -hex 32), JWT_SECRET, APP_URL, MINIAPP_URL
```

All configuration is environment-driven; the app fails fast on missing or
invalid values.

### Migrate

```bash
# DATABASE_URL = Supabase direct connection string (?sslmode=require)
DATABASE_URL="postgresql://postgres:...@db.xxx.supabase.co:5432/postgres?sslmode=require" pnpm migrate
```

> The RLS migration (0002) references the Supabase-provided `auth.jwt()`. It must
> run against a Supabase/PostgREST database, not vanilla Postgres.

### Develop

```bash
pnpm install
pnpm dev             # Fastify app + bot (BOT_MODE=polling by default)
pnpm dev:worker      # BullMQ worker (separate terminal)
pnpm test            # unit tests
pnpm typecheck       # tsc --noEmit
```

In polling mode the bot long-polls (no public URL needed). In production set
`BOT_MODE=webhook`; the app registers the webhook at `${APP_URL}/api/telegram`
with `secret_token` verification.

## Deploy

Two supported paths — pick one:

- **[Coolify](docs/deploy-coolify.md)** (self-hosted PaaS) — Coolify's proxy
  handles TLS automatically; deploys `app` + `worker` + `redis` from
  [`docker-compose.coolify.yml`](docker-compose.coolify.yml). No nginx.
- **[Your own VPS](docs/deploy-vps.md)** — the root
  [`docker-compose.yml`](docker-compose.yml) runs `app` + `worker` + `redis` +
  `nginx` (TLS via certbot).

Quick VPS start (see the [full guide](docs/deploy-vps.md) for env, migrations,
and certs):

```bash
docker compose up -d --build   # app, worker, redis, nginx
```

The Docker image builds the Mini App and the app serves its static build itself
(`SERVE_MINI_APP=true`), so both ship in one image — no separate frontend host or
volume. nginx just terminates TLS (Let's Encrypt) and proxies `api.<domain>`
(`/webhooks`, `/api`, `/health`) and `app.<domain>` (Mini App + SPA fallback) to
the app. Edit `docker/nginx.conf` to set your domains and cert paths.

Health check: `GET /health` → `{ "ok": true, "checks": { "queue": true }, ... }`.

> In both paths, run database migrations from a machine that can reach Supabase
> (`pnpm migrate`) — they are not applied inside the production container.

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

| Script                        | Purpose                    |
| ----------------------------- | -------------------------- |
| `pnpm dev` / `dev:worker`     | tsx watch for app / worker |
| `pnpm build`                  | tsup → `dist/`             |
| `pnpm start` / `start:worker` | run the built app / worker |
| `pnpm test`                   | vitest                     |
| `pnpm typecheck`              | `tsc --noEmit`             |
| `pnpm lint` / `format`        | ESLint / Prettier          |
| `pnpm migrate`                | apply SQL migrations       |

## Status

ClickUp and Wrike are fully wired — notifications and inline actions work end
to end. The provider-agnostic core and adapter contract are in place; Jira
slots in through the adapter checklist without core changes. Live provider API
surfaces (exact request/response shapes) should be confirmed against the real
APIs with credentials during first integration.
