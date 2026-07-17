# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Telegram aggregator (Bot + Mini App) over work-management systems: ClickUp and
Wrike are live (Phase 1), Jira is scaffolded (Phase 3). Provider webhook events
become Telegram notifications; tasks can be managed from chat and the Mini App.
The full spec is `docs/telegram-aggregator-spec.pdf` (v2.3); sections are cited
in code as `spec §N`.

## The iron rule (read before touching anything)

The **core** — the webhook endpoint, worker, notifier, bot, Mini App, and DB
layer — operates _only_ on the unified models in `src/models/unified.ts`. All
provider-specific knowledge (credential shapes, webhook lifecycle, payload
parsing, status mapping, rate limits) lives _exclusively_ inside an adapter
under `src/adapters/<provider>/`.

- The core must never branch on a provider name. If a core feature seems to need
  `if (provider === 'clickup')`, the adapter contract is wrong — extend the
  contract (`src/adapters/provider-adapter.ts` + `AdapterCapabilities` in
  `src/adapters/types.ts`) instead.
- A new provider = one adapter directory implementing `ProviderAdapter` + one
  `registry.register(...)` call in `src/adapters/index.ts`. Nothing else in the
  core should change.
- Adapters are resolved only through `registry.get(provider)`, keyed by the
  `:provider` route param and connection rows.

## Commands

This repo uses **pnpm 10** and **Node 22**. The root package and `mini-app/` are
separate pnpm packages.

```bash
pnpm install
pnpm dev                 # Fastify app + grammY bot (BOT_MODE=polling by default)
pnpm dev:worker          # BullMQ worker — separate process, separate terminal
pnpm test                # vitest run (whole suite)
pnpm test:watch          # vitest watch
pnpm typecheck           # tsc --noEmit
pnpm lint                # eslint .
pnpm format              # prettier --write .
pnpm build               # tsup → dist/
pnpm migrate             # apply migrations/*.sql (needs DATABASE_URL)
pnpm tunnel              # local tunnel for webhook testing
```

Run a single test file or filter by name:

```bash
pnpm vitest run src/adapters/wrike/wrike.test.ts
pnpm vitest run -t "handshake"
```

Mini App (in `mini-app/`, run from that directory): `pnpm dev`, `pnpm build`,
`pnpm preview`. It's React 18 + Vite + TanStack Query + `@telegram-apps/sdk-react`.

`pnpm migrate` needs `DATABASE_URL` (Supabase direct connection,
`?sslmode=require`). Migration `0002_rls.sql` uses Supabase's `auth.jwt()` and
must run against a Supabase/PostgREST database, not vanilla Postgres.

## Two processes

The app and the worker are **separate entrypoints** that scale independently:

- `src/server.ts` — Fastify app: webhook endpoint, grammY bot (webhook or
  polling), auth/API routes, `/health`, `/metrics`.
- `src/worker.ts` — BullMQ worker consuming the webhook queue.

They communicate only through the BullMQ/Redis queue. Both call
`registerAdapters()` at startup.

## Request pipeline (spec §5)

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

- **Raw body**: `src/server.ts` installs a JSON content-type parser that stashes
  the original bytes on `req.rawBody` _before_ parsing. Signature verification
  always runs over those bytes — never re-serialized JSON.
- **Fast-ACK**: the webhook route verifies and enqueues, then returns 200
  immediately; all real work happens in the worker.
- **Idempotency** is enforced at the DB level via
  `unique(subscription_id, dedupe_key)`; the adapter builds a stable `dedupeKey`
  per event. Duplicate deliveries are silently skipped.
- **Handshake**: some providers (Wrike) require a registration handshake —
  `adapter.handleHandshake(...)` returns a non-null response the endpoint replies
  with directly (no job enqueued).

## Adapter contract

`src/adapters/provider-adapter.ts` is the single interface every provider
implements; read its doc comments before editing an adapter. The core adapts its
behavior from `capabilities()` (an `AdapterCapabilities` descriptor), never from
the provider id. Notable contract points:

- `parseEvents` ALWAYS returns an array (Wrike batches; Jira expands a changelog).
- `enrichEvent` fills missing task data for `'minimal'`-payload providers; a
  no-op for `'rich'` ones. Gate it with `shouldEnrich(adapter)`.
- Status handling is category-based (`open | in_progress | done | cancelled`) —
  inline actions map to a category, and the adapter resolves the provider status
  id. `getAvailableStatuses` is per-task because Jira transitions depend on state.
- Adapter conformance is enforced by `src/adapters/conformance.test.ts`; there's
  a `FakeAdapter` (`src/adapters/fake.ts`) and `contract-helpers.ts` for tests.
- Provider HTTP calls go through a per-connection rate limiter
  (`src/adapters/rate-limiter.ts`), entered via `withConnection(...)`
  (`src/adapters/context.ts`).

## Security

- Provider credentials and webhook secrets are AES-256-GCM encrypted at rest
  (`iv:tag:ciphertext`, `src/crypto/`); `ENCRYPTION_KEY` never leaves the app.
- Webhook signatures verified over raw bytes (HMAC-SHA256): ClickUp `X-Signature`,
  Wrike `X-Hook-Secret`, Jira `X-Hub-Signature`.
- Telegram updates verified via `secret_token` (`TELEGRAM_WEBHOOK_SECRET`).
- `/connect <provider> <token>` deletes the token-bearing chat message. Providers
  needing multiple credential fields (Jira) connect via the Mini App instead,
  which renders the fields from `adapter.credentialFields()`.
- Mini App auth: Telegram `initData` HMAC validation (`src/auth/init-data.ts`) →
  app JWT (`src/auth/jwt.ts`). DB repositories in `src/db/` are all scoped by
  `user_id`.

## Configuration

All config is environment-driven and validated by zod at boot
(`src/config/env.ts`); the app **fails fast** on missing/invalid values — do not
add `process.env` reads elsewhere, extend the schema. Copy `.env.example` to
`.env`. `BOT_MODE=polling` (default) needs no public URL; `webhook` registers at
`${APP_URL}/api/telegram`.

## Conventions

- ESM throughout (`"type": "module"`); **imports of local files use the `.js`
  extension** even for `.ts` sources (e.g. `import { registry } from './registry.js'`).
- Logging is Pino via `src/logger.ts` (Fastify's own logger is disabled). Metrics
  via `src/metrics.ts` `inc(...)`, exposed at `/metrics`.
- Migrations are plain SQL in `migrations/`, applied in filename order by
  `pnpm migrate`.

## Spec-driven workflow (OpenSpec)

This project uses OpenSpec (`openspec/`, `schema: spec-driven`). Feature specs
live under `openspec/changes/<change>/specs/`. There are `opsx` skills/commands
(propose, apply, archive, sync, explore) for working through changes. When a task
maps to a spec change, prefer that workflow.

## Docs

- `README.md` — setup, deploy (Docker Compose + nginx), bot command quick-start.
- `docs/bot-commands.md` — full bot command reference.
- `docs/verification.md` — Phase 1 end-to-end verification runbook (which
  behaviors are covered by `pnpm test` vs. require live credentials, marked `[live]`).
