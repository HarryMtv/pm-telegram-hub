# Proposal: implement-telegram-aggregator

## Why

Teams that live in Telegram have no native integration with work systems such as ClickUp and Wrike. They rely on email notifications and manual checks. This change builds a Telegram-based aggregator (Integration Service + Bot + Mini App) that delivers provider events to Telegram and lets users manage tasks from chat, per the spec in `docs/telegram-aggregator-spec.pdf` (v2.3).

Starting Phase 1 with two providers (ClickUp and Wrike) forces an honest adapter abstraction from day one: the core never contains provider-specific code.

## What Changes

- New Integration Service (Node.js 22, TypeScript, Fastify 5) that receives provider webhooks, normalizes them into unified models, and delivers notifications to Telegram.
- New `ProviderAdapter` interface plus adapter registry; ClickUp (API v2) and Wrike (API v4) adapters in Phase 1, Jira Cloud (REST v3) in Phase 3.
- New Telegram bot (grammY): notifications, inline actions (take/done/comment), and quick commands (`/connect`, `/subscribe`, `/newtask`, `/task`, `/status`, `/assign`, `/due`, `/browse`, `/map`, `/comment`).
- New Telegram Mini App (React 18 + TypeScript + Vite, @telegram-apps/sdk-react, TanStack Query): onboarding, subscriptions, unified inbox, mappings.
- New Supabase (PostgreSQL) schema: `users`, `provider_connections`, `webhooks`, `mappings`, `subscriptions`, `notification_log` - fully provider-agnostic.
- New BullMQ + Redis queue for async webhook processing with fast-ACK endpoint `POST /webhooks/:provider`, retries with exponential backoff, and DLQ.
- App-side AES-256-GCM encryption of provider credentials and webhook secrets.
- Rate-limited notifier honoring Telegram Bot API limits (per-chat token bucket + global limiter, digest batching for groups).
- Docker Compose deployment on a VPS (app, worker, redis, nginx) with HTTPS.

## Capabilities

### New Capabilities

- `provider-adapters`: The `ProviderAdapter` contract (capabilities descriptor, webhook lifecycle, event parsing/enrichment, task actions, container navigation, statuses, rate limiting) and the ClickUp/Wrike implementations plus adapter registry.
- `webhook-processing`: Fast-ACK webhook endpoint, signature verification, handshake handling, BullMQ queueing, worker pipeline (parse, enrich, match subscriptions, dedupe, deliver), retries and DLQ.
- `data-model`: Provider-agnostic Supabase schema, app-level data isolation, RLS via Telegram JWT claim for Mini App, AES-256-GCM credential encryption.
- `telegram-bot`: Bot commands, inline actions on notifications, notification templates (HTML parse mode), Telegram webhook secret validation, polling mode for development.
- `notification-delivery`: Rate-limited notifier (per-chat + global limits), DB-level idempotency via `notification_log` unique constraint, digest batching for groups.
- `mini-app`: Telegram Mini App with initData auth (HMAC validation + short-lived Supabase-compatible JWT), Connections/Subscriptions/Tasks(unified inbox)/Mappings screens.
- `deployment`: Docker Compose stack, nginx reverse proxy with HTTPS (Let's Encrypt), health checks, Pino logging, monitoring metrics.

### Modified Capabilities

None - this is a greenfield implementation; `openspec/specs/` is empty.

## Impact

- Codebase: new backend service (`src/`), worker process, bot, and Mini App frontend - currently the repo has no application code.
- Dependencies: Node.js 22 LTS, TypeScript, Fastify 5.x, grammY, BullMQ, Redis 7, React 18, Vite, @telegram-apps/sdk-react, TanStack Query, Supabase JS client.
- External systems: Supabase (managed PostgreSQL), Telegram Bot API, ClickUp API v2, Wrike API v4 (Jira Cloud REST v3 in Phase 3), VPS with Docker.
- Configuration: new environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ENCRYPTION_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `REDIS_URL`, rate-limit defaults, etc.).
- Rollout: three phases per the spec roadmap - Phase 1 notifications (weeks 1-3), Phase 2 Mini App + task bot (weeks 4-6), Phase 3 Jira + unified inbox + monetization (weeks 7-9).
