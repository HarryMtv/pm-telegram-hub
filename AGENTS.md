# AGENTS.md

Guidance for AI coding agents working in this repository. It assumes you know
nothing about the project — read it fully before touching anything.

## Project overview

**pm-telegram-hub** is a Telegram aggregator (Bot + Mini App) over
work-management systems. Provider webhook events (task created/updated, status
changed, comment added, …) become Telegram notifications; tasks can be managed
from the chat and from a Telegram Mini App. ClickUp and Wrike are live (Phase
1); Jira is scaffolded (Phase 3). Code comments cite the product specification as `spec §N`.

Technology stack:

- **Backend**: Node.js 22, TypeScript (strict, ESM), Fastify 5, grammY
  (Telegram bot framework), BullMQ + Redis (ioredis), Pino (logging), Zod
  (config validation).
- **Database**: Supabase (managed PostgreSQL) via `@supabase/supabase-js`;
  plain-SQL migrations in `migrations/`.
- **Mini App**: separate pnpm package in `mini-app/` — React 19, Vite 8,
  TanStack Query, `@telegram-apps/sdk-react`, Radix UI + Tailwind CSS v4
  (shadcn-style components in `mini-app/src/components/ui/`).
- **Tooling**: pnpm 10, tsup (build), Vitest (tests), ESLint 9 flat config +
  typescript-eslint, Prettier with import sorting.

## The iron rule (read before touching anything)

The **core** — webhook endpoint, worker, notifier, bot, Mini App, DB layer —
operates _only_ on the unified models in `src/models/unified.ts`. All
provider-specific knowledge (credential shapes, webhook lifecycle, payload
parsing, status mapping, rate limits) lives _exclusively_ inside an adapter
under `src/adapters/<provider>/`.

- The core must never branch on a provider name. If a core feature seems to
  need `if (provider === 'clickup')`, the adapter contract is wrong — extend
  the contract (`src/adapters/provider-adapter.ts` + `AdapterCapabilities` in
  `src/adapters/types.ts`) instead.
- A new provider = one adapter directory implementing `ProviderAdapter` + one
  `registry.register(...)` call in `src/adapters/index.ts`. Nothing else in the
  core should change.
- Adapters are resolved only through `registry.get(provider)`, keyed by the
  `:provider` route param and connection rows.
- The same rule applies to the DB schema: no provider-specific columns;
  provider-dependent data lives in the `provider` text column and `jsonb`
  fields only (see `migrations/0001_init.sql`).

## Runtime architecture: two processes

The app and the worker are **separate entrypoints** that scale independently
and communicate only through the BullMQ/Redis queue. Both call
`registerAdapters()` at startup.

- `src/server.ts` — Fastify app: webhook endpoint, grammY bot (webhook or
  polling), auth/API routes, `/health`, `/metrics`, and (when
  `SERVE_MINI_APP=true`) the Mini App's static build with SPA fallback.
- `src/worker.ts` — BullMQ worker consuming the webhook queue.

Request pipeline (spec §5):

```
POST /webhooks/:provider          (src/queue/routes.ts)
  → verify signature over req.rawBody (HMAC-SHA256), fast-ACK 200
  → enqueue WebhookJobData to BullMQ (Redis)
        │
        ▼
worker processJob                 (src/queue/worker.ts)
  → adapter.parseEvents(payload, headers)   → UnifiedEvent[]  (always an array)
  → adapter.enrichEvent(...)  when capabilities say the payload is 'minimal'
  → fanOut: for each active subscription — event-type filter, container filter,
            "assigned to me" filter, self-echo suppression,
            idempotent insert (unique(subscription_id, dedupe_key)), deliver, record
        │
        ▼
notifier deliverEvent             (src/notifier/) → rate-limited Telegram Bot API
```

Key invariants:

- **Raw body**: `src/server.ts` installs a JSON content-type parser that
  stashes the original bytes on `req.rawBody` _before_ parsing. Signature
  verification always runs over those bytes — never re-serialized JSON.
- **Fast-ACK**: the webhook route verifies and enqueues, then returns 200
  immediately; all real work happens in the worker.
- **Idempotency** is enforced at the DB level via
  `unique(subscription_id, dedupe_key)`; the adapter builds a stable
  `dedupeKey` per event. Duplicate deliveries are silently skipped.
- **Handshake**: some providers (Wrike) require a registration handshake —
  `adapter.handleHandshake(...)` returns a non-null response the endpoint
  replies with directly (no job enqueued).
- **Self-echo suppression**: events whose actor is the connection owner are not
  echoed back to them (owner identity stored by migration
  `0003_connection_account.sql`).

## Adapter contract

`src/adapters/provider-adapter.ts` is the single interface every provider
implements; read its doc comments before editing an adapter. The core adapts
its behavior from `capabilities()` (an `AdapterCapabilities` descriptor), never
from the provider id. Notable contract points:

- `parseEvents` ALWAYS returns an array (Wrike batches; Jira expands a
  changelog).
- `enrichEvent` fills missing task data for `'minimal'`-payload providers; a
  no-op for `'rich'` ones. Gate it with `shouldEnrich(adapter)`
  (`src/adapters/contract-helpers.ts`).
- Status handling is category-based (`open | in_progress | done | cancelled`)
  — inline actions map to a category, and the adapter resolves the provider
  status id. `getAvailableStatuses` is per-task because Jira transitions depend
  on state.
- Adapter conformance is enforced by `src/adapters/conformance.test.ts`;
  there's a `FakeAdapter` (`src/adapters/fake.ts`) and `contract-helpers.ts`
  for tests.
- Provider HTTP calls go through a per-connection rate limiter
  (`src/adapters/rate-limiter.ts`), entered via `withConnection(...)`
  (`src/adapters/context.ts`).

## Repository layout

```
src/
  adapters/        ProviderAdapter contract, registry, rate limiter,
                   conformance tests, clickup/, wrike/, jira/
  api/             Mini App REST API routes (task feed etc.)
  auth/            Mini App auth: Telegram initData HMAC → app JWT
  bot/             grammY bot: commands, inline-callback actions, webhook/polling
  config/          zod-validated environment (fails fast on boot)
  crypto/          AES-256-GCM + HMAC helpers
  db/              Supabase client + repositories (all scoped by user_id)
  models/          unified domain types (the only types the core knows)
  notifier/        HTML templates, Telegram rate limiters, delivery, digest
  queue/           BullMQ queue, fast-ACK webhook route, worker pipeline
  services/        connection service (verify → persist → register webhook),
                   adapter runner
  server.ts        Fastify app entrypoint (app + bot)
  worker.ts        BullMQ worker entrypoint
migrations/        SQL migrations, applied in filename order by `pnpm migrate`
mini-app/          Telegram Mini App (separate pnpm package, React 19 + Vite)
scripts/           migrate.ts, tunnel.ts (cloudflared for webhook dev),
                   dev-token.ts (mint a dev JWT for the Mini App)
docker/            nginx config (TLS termination, routing)
docs/              bot command reference, deploy guides
openspec/          OpenSpec spec-driven workflow (changes, archived specs)
```

## Build and test commands

This repo uses **pnpm 10** and **Node 22** (see `.nvmrc`, `engines` in
`package.json`). The root package and `mini-app/` are separate pnpm packages
(each has its own lockfile) — run `pnpm install` in both.

```bash
pnpm install
pnpm dev                 # Fastify app + grammY bot (BOT_MODE=polling by default)
pnpm dev:worker          # BullMQ worker — separate process, separate terminal
pnpm test                # vitest run (whole suite: 13 files, ~98 tests)
pnpm test:watch          # vitest watch
pnpm typecheck           # tsc --noEmit
pnpm lint                # eslint .
pnpm format              # prettier --write .
pnpm build               # tsup → dist/ (server.js + worker.js, ESM, sourcemaps)
pnpm start               # node dist/server.js
pnpm start:worker        # node dist/worker.js
pnpm migrate             # apply migrations/*.sql (needs DATABASE_URL)
pnpm tunnel              # local cloudflared tunnel for webhook testing
```

Run a single test file or filter by name:

```bash
pnpm vitest run src/adapters/wrike/wrike.test.ts
pnpm vitest run -t "handshake"
```

Mini App (in `mini-app/`, run from that directory): `pnpm dev` (Vite dev
server, proxies `/api` to `http://127.0.0.1:3001`), `pnpm build`,
`pnpm preview`. To debug it in a browser without Telegram, mint a dev JWT with
`pnpm tsx scripts/dev-token.ts <telegram_id>` (the user must exist in the DB —
interact with the bot once first).

`pnpm migrate` needs `DATABASE_URL` (Supabase direct connection,
`?sslmode=require`). Migration `0002_rls.sql` uses Supabase's `auth.jwt()` and
must run against a Supabase/PostgREST database, not vanilla Postgres.
Migrations are **not** applied inside the production container — run them from
a machine that can reach Supabase.

## Configuration

All config is environment-driven and validated by zod at boot
(`src/config/env.ts`); the app **fails fast** on missing/invalid values — do
not add `process.env` reads elsewhere, extend the schema instead. Copy
`.env.example` to `.env` and fill in: `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `ENCRYPTION_KEY` (`openssl rand -hex 32`),
`JWT_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `APP_URL`, `MINIAPP_URL`. Defaults:
`BOT_MODE=polling` (no public URL needed; `webhook` registers at
`${APP_URL}/api/telegram` with `secret_token` verification), `PORT=3000`,
`REDIS_URL=redis://127.0.0.1:6379`, `SERVE_MINI_APP=false`.

## Code style guidelines

- **ESM throughout** (`"type": "module"`); **imports of local files use the
  `.js` extension** even for `.ts` sources (e.g. `import { registry } from
  './registry.js'`).
- TypeScript strict mode with `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`; target ES2022,
  `moduleResolution: bundler`.
- Prettier: semicolons, single quotes, trailing commas, print width 100, 2-space
  tabs; imports are auto-sorted by `@ianvs/prettier-plugin-sort-imports`
  (third-party → `@telegram-apps/*` → relative). Run `pnpm format` before
  committing.
- ESLint: `eslint.configs.recommended` + `typescript-eslint` recommended;
  unused vars are an error unless prefixed with `_`.
- Logging is Pino via `src/logger.ts` (Fastify's own logger is disabled).
  Metrics via `src/metrics.ts` `inc(...)`, exposed at `/metrics`.
- Migrations are plain SQL in `migrations/`, applied in filename order; make
  them idempotent (`if not exists`, `add column if not exists`).
- User-facing bot messages are in English.
- PostgREST returns PostgreSQL `bigint` columns as **strings** — `telegram_id`
  and `telegram_chat_id` are `string` on reads, `number` on writes (see the row
  types in `src/db/client.ts`).

## Testing instructions

- Tests are Vitest, colocated as `src/**/*.test.ts` (13 files, ~98 tests;
  `vitest.config.ts`, node environment, `vitest.setup.ts` loads dotenv).
- The suite is fully self-contained — no live credentials, Redis, or database
  needed. External boundaries are faked: `FakeAdapter` for the provider
  contract, swappable deps (e.g. `FanOutDeps` in `src/queue/worker.ts`) for the
  DB/Telegram sides.
- Coverage focus: crypto
  round-trip/tamper rejection, HMAC verification, adapter conformance +
  per-adapter parsing/dedupeKey/status categories, worker fan-out (filters,
  idempotent skip), notifier templates (HTML escaping), API routes, bot
  callbacks.
- Anything requiring real provider credentials or a live Telegram bot is a
  manual check marked `[live]` — do not try to automate those.
- Before finishing a change, run: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Security considerations

- Provider credentials and webhook secrets are AES-256-GCM encrypted at rest
  (`iv:tag:ciphertext`, `src/crypto/`); `ENCRYPTION_KEY` never leaves the app.
- Webhook signatures are verified over the **raw** request bytes (HMAC-SHA256):
  ClickUp `X-Signature`, Wrike `X-Hook-Secret` (handshake + notification),
  Jira `X-Hub-Signature`.
- Telegram updates are verified via `secret_token`
  (`TELEGRAM_WEBHOOK_SECRET`, header `X-Telegram-Bot-Api-Secret-Token`).
- `/connect <provider> <token>` deletes the token-bearing chat message.
  Providers needing multiple credential fields (Jira) connect via the Mini App
  instead, which renders the fields from `adapter.credentialFields()`.
- Mini App auth: Telegram `initData` HMAC validation (`src/auth/init-data.ts`)
  → short-lived app JWT (`src/auth/jwt.ts`). The backend uses the Supabase
  **service role key** (bypasses RLS), so every repository in `src/db/` MUST
  stay scoped by `user_id`/`connection_id` at the application level. The Mini
  App talks to PostgREST under its own JWT with RLS policies keyed on the
  `telegram_id` claim (migration `0002_rls.sql`).
- Delivery is idempotent at the DB level (`unique(subscription_id,
  dedupe_key)`).
- Never commit `.env`; never log decrypted credentials or webhook secrets.

## Deployment

Two supported paths (pick one), both using the same multi-stage `Dockerfile`
(backend build → Mini App build → non-root runtime image with a `/health`
healthcheck; app and worker share the image):

- **Coolify** (self-hosted PaaS) — `docker-compose.coolify.yml` runs `app` +
  `worker` + `redis`; Coolify's proxy handles TLS. See `docs/deploy-coolify.md`.
- **Own VPS** — root `docker-compose.yml` runs `app` + `worker` + `redis` +
  `nginx` (TLS via certbot, `docker/nginx.conf`). See `docs/deploy-vps.md`.
  Quick start: `docker compose up -d --build`. The worker scales with
  `docker compose up -d --scale worker=N`.

The Docker image builds the Mini App and the app serves its static build itself
(`SERVE_MINI_APP=true`), so everything ships in one image — nginx only
terminates TLS and proxies `api.<domain>` (`/webhooks`, `/api`, `/health`) and
`app.<domain>` (Mini App + SPA fallback) to the app. Health check:
`GET /health` → `{ "ok": true, "checks": { "queue": true }, ... }`.

## Spec-driven workflow (OpenSpec)

This project uses OpenSpec (`openspec/`, `schema: spec-driven`). Feature specs
live under `openspec/changes/<change>/specs/`; completed work is archived in
`openspec/changes/archive/` (e.g. the original
`implement-telegram-aggregator` change with per-capability specs). There are
`opsx` skills/commands (propose, apply, archive, sync, explore) for working
through changes. When a task maps to a spec change, prefer that workflow.

## Documentation

- `README.md` — setup, deploy overview, bot command quick-start.
- `docs/bot-commands.md` — full bot command reference (parameters, examples).
- `docs/deploy-coolify.md`, `docs/deploy-vps.md` — deployment guides.
- `CLAUDE.md` — a condensed version of this file kept for Claude Code; keep the
  two in sync when you change one.

## Current status

Phase 1 (P0) — notifications + inline actions for ClickUp and Wrike — is
implemented, along with the Mini App screens (an active OpenSpec change,
`mini-app-mvp-screens`). The provider-agnostic core and adapter contract are in
place; Jira (Phase 3) slots in via the adapter checklist without core changes.
Live provider API surfaces (exact request/response shapes) should be confirmed
against the real APIs with credentials during first integration.
