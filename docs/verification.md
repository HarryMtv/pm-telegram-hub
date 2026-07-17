# Verification — Phase 1

This document is the runbook for verifying the Phase 1 notification wedge
end-to-end. Some steps require live provider credentials and a reachable
Telegram bot and cannot run in CI without them; those are marked **[live]**.
Everything else is covered by the automated test suite (`pnpm test`) or was
verified during implementation.

## Automated coverage (runs in `pnpm test`)

| Area               | Test file                              | What it asserts                                                                                                         |
| ------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| AES-256-GCM        | `src/crypto/aes.test.ts`               | round-trip, fresh IV, tamper rejection                                                                                  |
| HMAC (signatures)  | `src/crypto/hmac.test.ts`              | verify over raw bytes, constant-time                                                                                    |
| Adapter contract   | `src/adapters/conformance.test.ts`     | registry, signature verify, capabilities-driven enrich, status-by-category                                              |
| ClickUp adapter    | `src/adapters/clickup/clickup.test.ts` | event map, single-event parse, dedupeKey (`event:history_id`, sha256 fallback), status categories, `X-Signature` verify |
| Wrike adapter      | `src/adapters/wrike/wrike.test.ts`     | batched parse, dedupeKey (+status ids, sha256 fallback), group→category, handshake echo, `X-Hook-Secret` verify         |
| Worker fan-out     | `src/queue/worker.test.ts`             | event-type filter, container filter, **idempotent skip on duplicate**, deliver+record                                   |
| Notifier templates | `src/notifier/templates.test.ts`       | HTML escape, provider badge, per-event templates                                                                        |

Schema idempotency constraints (`unique(subscription_id, dedupe_key)`,
`unique(connection_id, telegram_chat_id)`) were verified against a real
PostgreSQL instance during implementation (duplicate inserts rejected with
`23505`).

Signature rejection is covered by the adapter unit tests (wrong secret, tampered
body, missing header all return `false`).

## Manual / live checks

> Prerequisites: a configured `.env` (real `TELEGRAM_BOT_TOKEN`, Supabase
> `DATABASE_URL`), migrations applied, Redis running, the app + worker up.

### 1. Connect a provider

In a private chat with the bot:

```
/connect clickup <your-personal-token>
```

- The bot replies `✅ Подключён ClickUp.` and **deletes the message** containing
  the token (it is gone from history).
- A `provider_connections` row exists (credentials column is `iv:tag:...`, not
  plaintext) and a `webhooks` row exists with an encrypted secret.

Repeat with Wrike (`/connect wrike <permanent-token>`); confirm the Wrike
handshake succeeded (server logs `handshake` / 200 on the registration request).

### 2. Subscribe

```
/subscribe
```

- A `subscriptions` row exists for this chat + connection with the full
  `event_types` default array.
- `/subscribe` again → no duplicate row (idempotent via
  `unique(connection_id, telegram_chat_id)`).

### 3. Trigger a notification **[live]**

- Change a task status in ClickUp → a `task.status_changed` notification arrives
  in the chat, formatted `[ClickUp] <name>: <old> → <new>`, with inline buttons.
- Create/batch events in Wrike → one notification per event arrives.
- **Idempotency [live-ish]:** have the provider redeliver the same webhook (or
  POST a signed duplicate). The `notification_log` unique constraint means no
  second message — covered by the worker fan-out test for the logic, and the
  DB-level test for the constraint.

### 4. Inline actions **[live]**

- Tap **✅ Готово** under a ClickUp notification → the task's status moves to the
  ClickUp status whose category is `done` (no provider code in the core).
- Repeat for Wrike (status → `customStatus` with group `Completed`).
- Tap **💪 Взять** → status category `in_progress`.

### 5. Signature / security

- POST a webhook with a wrong signature → `401 invalid signature`, nothing
  enqueued.
- POST to an unknown provider → `404`.
- Forged Telegram update (wrong/missing `X-Telegram-Bot-Api-Secret-Token`) →
  `401`.

### 6. Health & deployment

- `GET /health` → `{ "ok": true, "checks": { "queue": true } }` when Redis is up;
  `queue:false` (promptly, within ~1.5s) when Redis is down.
- `docker compose up -d --build` brings up app, worker, redis, nginx; the app
  healthcheck passes once Redis is healthy.
