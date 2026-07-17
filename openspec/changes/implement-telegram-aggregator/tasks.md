# Tasks: implement-telegram-aggregator

Implementation checklist derived from `proposal.md`, `design.md`, and the seven capability specs, sequenced by the spec roadmap (`docs/telegram-aggregator-spec.pdf` v2.3, §12).

**Phasing:** Tasks are grouped and ordered by dependency, and labelled by phase. Phase 1 (P0, weeks 1–3) is the notification wedge — bot notifications from ClickUp + Wrike with inline actions — and establishes the provider-agnostic core everything else depends on. Phase 2 (P1, weeks 4–6) adds the Mini App and the task bot. Phase 3 (weeks 7–9) adds the Jira adapter and the unified inbox. Phase 1 must reach a deployable, demoable state before later phases start; many Phase 2/3 tasks extend contracts and screens built in Phase 1.

The iron rule from spec §2 holds throughout: the core operates only on unified models; provider-specific code lives only inside an adapter. If a task seems to require the core to know a provider name, stop and redesign the adapter contract instead.

## 1. Repository bootstrap & tooling

- [x] 1.1 Decide and document repository layout (single Fastify app hosting webhook endpoint + bot + worker entry points, plus a separate Vite Mini App; shared `src` for unified models/crypto/config)
- [x] 1.2 Initialize Node.js 22 LTS project: `package.json` with workspace-free structure (or workspaces if chosen), TypeScript, build/dev scripts
- [x] 1.3 Configure `tsconfig.json` (strict mode, path aliases), ESLint, Prettier
- [x] 1.4 Add dependencies: `fastify`, `grammy`, `bullmq`, `ioredis`, `@supabase/supabase-js`, `pino`, `zod`
- [x] 1.5 Implement typed environment config loader (zod schema) covering every variable in spec §9, fail-fast on missing/invalid, generate `.env.example`
- [x] 1.6 Scaffold Fastify 5 server with structured Pino logging and a `GET /health` route

## 2. Data model (Phase 1)

- [x] 2.1 Write SQL migration for all six tables exactly per spec §3: `users`, `provider_connections`, `webhooks`, `mappings`, `subscriptions`, `notification_log` — no provider-specific columns
- [x] 2.2 Add all uniqueness constraints from spec §3.2: `unique(user_id, provider, scope_id)`, `unique(provider, provider_webhook_id)`, `unique(user_id, provider, alias)`, `unique(connection_id, telegram_chat_id)`, `unique(subscription_id, dedupe_key)`
- [x] 2.3 Add supporting indexes: active subscriptions by `connection_id`, webhook lookup by `provider_webhook_id`
- [x] 2.4 Create a Supabase JS client wrapper using the service key (backend only) with typed table helpers
- [x] 2.5 Implement app-level data isolation: every backend query helper filters by `user_id`/`connection_id` (service key bypasses RLS)
- [x] 2.6 Define RLS policies keyed on the `telegram_id` JWT claim so the Mini App can query Supabase directly (PostgREST/Realtime)

## 3. Encryption & security primitives

- [x] 3.1 Implement AES-256-GCM `encrypt`/`decrypt` using `node:crypto` with a unique IV per record, stored as `iv:tag:ciphertext` (base64)
- [x] 3.2 Load `ENCRYPTION_KEY` (32-byte hex), validate length on boot, never log or transmit it
- [x] 3.3 Add typed read/write helpers for `provider_connections.credentials` and `webhooks.secret` that always encrypt/decrypt at the boundary
- [x] 3.4 Implement shared HMAC-SHA256 helpers (constant-time compare) for webhook signatures and Mini App initData validation

## 4. Unified models & ProviderAdapter contract

- [x] 4.1 Define unified domain types: `ProviderCredentials`, `AdapterCapabilities`, `UnifiedEventType`, `UnifiedEvent`, `Container`, `StatusDef`, `UnifiedTask`, plus action types (`CreateTaskInput`, `TaskPatch`, `TaskRef`, `AccountInfo`, `WebhookRef`, `WebhookScope`, `HandshakeResponse`, `RateLimitConfig`)
- [x] 4.2 Define the `ProviderAdapter` interface with every method from spec §2.1 (capabilities, handshake, verify/parse/enrich, webhook lifecycle, task actions, navigation, statuses, rate limit)
- [x] 4.3 Implement the adapter registry (`id` → adapter) with a `get(provider)` that rejects unknown providers
- [x] 4.4 Implement the per-connection rate limiter (token bucket + mandatory `Retry-After` compliance on 429) that all provider API calls must pass through
- [x] 4.5 Add a conformance test using a fake adapter that exercises the core pipeline end-to-end without a real provider

## 5. ClickUp adapter (API v2) — Phase 1

- [x] 5.1 `verifyCredentials` via `GET /api/v2/user`; `scope_id = team_id`; credentials `{ token }`
- [x] 5.2 `verifyWebhook`: HMAC-SHA256 over raw body against `X-Signature`, per-webhook secret from DB
- [x] 5.3 `parseEvents`: one event per request → single-element `UnifiedEvent[]`; map event types per §4.1; `dedupeKey = event + ':' + history_items[].id` (sha256 body fallback)
- [x] 5.4 `enrichEvent` via `GET /api/v2/task/{id}` through the connection limiter (payload is minimal)
- [x] 5.5 `registerWebhook` via `POST /team/{id}/webhook`, store the provider-returned secret encrypted; `deleteWebhook`; `handleHandshake` always `null`
- [x] 5.6 `capabilities()`: `{ webhookSetup: 'auto', payload: 'minimal' }`
- [x] 5.7 `listContainers`: team → space → folder (+folderless lists) → list, `canContainTasks: true` only on `tasklist`
- [x] 5.8 `getAvailableStatuses` (per list/workflow) + category mapping; `setStatus` via `PUT /task/{id}` field `status`
- [x] 5.9 Task actions: `createTask` (`POST /list/{list_id}/task`), `updateTask`, `addComment` (`POST /task/{id}/comment`), `getTask`
- [x] 5.10 `rateLimit(connection)`: per-plan rpm (default 100)

## 6. Wrike adapter (API v4) — Phase 1

- [x] 6.1 `verifyCredentials` via `GET /api/v4/contacts?me=true`; `scope_id = account_id`
- [x] 6.2 `handleHandshake`: echo `X-Hook-Secret` in the response for registration; `verifyWebhook`: HMAC-SHA256 of body against our secret in `X-Hook-Secret`
- [x] 6.3 `parseEvents`: batched array → one `UnifiedEvent` per element; map event types per §4.2; `dedupeKey = eventType + ':' + taskId + ':' + lastUpdatedDate` (+status ids for status events; sha256 fallback)
- [x] 6.4 `enrichEvent` via `GET /api/v4/tasks/{taskId}` (minimal payload)
- [x] 6.5 `registerWebhook` (account/space/folder scopes, system-generated secret stored encrypted); `deleteWebhook`
- [x] 6.6 `capabilities()`: `{ webhookSetup: 'auto', payload: 'minimal' }`
- [x] 6.7 `listContainers`: account → spaces → folders (tree via `childIds`), `canContainTasks: true` for every folder
- [x] 6.8 `getAvailableStatuses`: map `customStatuses[].group` (Active/Completed/Deferred/Cancelled → in_progress/done/open/cancelled) via `GET /workflows`
- [x] 6.9 Task actions: `createTask` (`POST /folders/{folderId}/tasks`), `updateTask`/`setStatus` (`PUT /tasks/{id}` with `customStatus`), `addComment` (`POST /tasks/{id}/comments`), `getTask`
- [x] 6.10 `rateLimit(connection)`: conservative default + dynamic `Retry-After`

## 7. Webhook processing pipeline — Phase 1

- [x] 7.1 Configure Fastify raw-body capture so HMAC is computed over original bytes
- [x] 7.2 Implement `POST /webhooks/:provider`: resolve adapter, handshake short-circuit, read raw body, look up secret by webhook id, verify signature, enqueue a BullMQ job with the raw payload, respond 200 immediately
- [x] 7.3 Configure BullMQ queue + Redis connection
- [x] 7.4 Implement the worker: `parseEvents(payload, headers)` → per event `enrichEvent` (rate-limited via connection owner) for minimal-payload adapters, no-op for rich
- [x] 7.5 Match active subscriptions for the connection, applying container filters derived from task data
- [x] 7.6 Per subscription: `INSERT INTO notification_log ... ON CONFLICT (subscription_id, dedupe_key) DO NOTHING` and skip on conflict
- [x] 7.7 Render the message template and hand off to the notifier; record `telegram_message_id` on success
- [x] 7.8 Configure exponential-backoff retries and a dead-letter queue after N attempts

## 8. Notification delivery — Phase 1

- [x] 8.1 Implement the notifier that sends messages through the grammY bot
- [x] 8.2 Implement Telegram limit compliance: global limiter (~30 msg/s) + per-chat token bucket (~1 msg/s private chat, 20 msg/min group)
- [x] 8.3 Implement HTML-parse-mode templates per `UnifiedEventType` with provider badge, escaping only `<`, `>`, `&`
- [x] 8.4 Confirm delivery idempotency via the `notification_log` unique constraint across worker retries
- [ ] 8.5 Reserve the digest-batching extension point for group bursts (implemented in Phase 2)

## 9. Telegram bot — P0 commands & inline actions — Phase 1

- [x] 9.1 Set up grammY bot with webhook and `BOT_MODE=polling` paths
- [x] 9.2 Register via `setWebhook(..., { secret_token })` and verify `X-Telegram-Bot-Api-Secret-Token` on every update
- [x] 9.3 `/start` (greeting + Mini App button), `/help`
- [x] 9.4 `/connect <provider> <token>`: call `verifyCredentials`, persist connection (encrypted), `deleteMessage` the user's message; reject complex-credential providers (direct to Mini App)
- [x] 9.5 `/subscribe`, `/unsubscribe` (idempotent via the `unique(connection_id, telegram_chat_id)` constraint)
- [x] 9.6 Inline buttons under notifications & task cards — "Take" (in_progress), "Done" (done), "Comment" — via `getAvailableStatuses` + `setStatus` with zero provider-specific code in the core
- [x] 9.7 Deep links / `web_app` buttons routing multi-step flows into the Mini App

## 10. Deployment basics — Phase 1

- [x] 10.1 Multi-stage Dockerfiles for `app` (service + bot) and `worker`
- [x] 10.2 `docker-compose.yml`: `app`, `worker`, `redis:7-alpine` (persistent volume), `nginx:alpine`, with restart policies
- [x] 10.3 nginx config: TLS via Let's Encrypt (TLS 1.2+), HTTP→HTTPS redirect, `api.` proxying `/webhooks/*` and `/api/*` to `app`, `app.` reserved for Mini App static
- [x] 10.4 Health check reflects Redis/queue connectivity; compose restart policy in place
- [x] 10.5 Pino logs to stdout with logrotate on the host

## 11. Phase 1 verification, tests & docs

- [ ] 11.1 End-to-end test: signed ClickUp webhook → notification in a test chat; signed Wrike batch (with handshake) → notifications
- [x] 11.2 Verify idempotency (re-delivered webhook produces no duplicate message) and signature rejection (tampered body rejected)
- [ ] 11.3 Verify inline "Done"/"Take" change status on both providers without core changes
- [x] 11.4 Write README setup and env-var documentation
- [x] 11.5 Mark Phase 1 demoable; freeze the adapter contract

## 12. Mini App foundation — Phase 2

- [x] 12.1 Scaffold Vite + React 18 + TypeScript app with `@telegram-apps/sdk-react` (theme, viewport, BackButton, MainButton) and TanStack Query
- [x] 12.2 Backend `POST /api/auth/init-data`: validate initData signature (key `HMAC_SHA256("WebAppData", BOT_TOKEN)`), check `auth_date` window (~1h), issue short-lived Supabase-compatible JWT with `telegram_id` claim
- [x] 12.3 Mini App API client: exchange initData for JWT, store/refresh it, attach to requests
- [ ] 12.4 Wire Telegram theme/viewport and navigation primitives

## 13. Mini App screens — Phase 2

- [x] 13.1 Connections screen: connect/disconnect providers; credential forms rendered from adapter metadata; workspace selection; webhook registration, or step-by-step admin instructions when `webhookSetup: 'admin-required'`
- [ ] 13.2 Subscriptions screen: chats × event types × container filters, container tree from `listContainers`
- [ ] 13.3 Mappings screen: manage aliases (alias → container, optional default) used by `/newtask`

## 14. Task bot — P1 commands — Phase 2

- [x] 14.1 `/newtask <name> [#alias]` — create task in the mapped (or default) container
- [x] 14.2 `/task <id>` — short card via `getTask` + inline keyboard
- [x] 14.3 `/comment <id> <text>`, `/status <id> <status>`, `/assign <id> @user`, `/due <id> <date>`
- [x] 14.4 `/browse`, `/map` over the unified container tree

## 15. Group digest batching — Phase 2

- [x] 15.1 Detect bursts to a single group within the batching window and collapse them into one digest message instead of individual sends

## 16. Jira adapter (REST API v3) — Phase 3

- [x] 16.1 Basic-auth credentials `{ baseUrl, email, apiToken }`, `scope_id` = site URL, `verifyCredentials`
- [ ] 16.2 `capabilities()`: `{ webhookSetup: 'admin-required', payload: 'rich' }`; Mini App shows admin webhook instructions (URL + generated secret + event list + optional JQL)
- [x] 16.3 `verifyWebhook`: `X-Hub-Signature` in `sha256=<hex>` form, our secret from DB
- [x] 16.4 `parseEvents`: expand `jira:issue_updated` changelog items into multiple `UnifiedEvent`s; `dedupeKey` from `X-Atlassian-Webhook-Identifier` + changelog-item index
- [x] 16.5 `enrichEvent` returns the event unchanged (rich payload, no fetch)
- [x] 16.6 `getAvailableStatuses` via `GET .../transitions` with `statusCategory` mapping (new→open, indeterminate→in_progress, done→done); `setStatus` via `POST .../transitions`
- [x] 16.7 ADF ↔ text conversion: `addComment` wraps text in a minimal ADF doc; `getTask` renders ADF to text/HTML
- [x] 16.8 `listContainers` (site → project, `canContainTasks: true`), task actions (`POST/PUT /rest/api/3/issue[...]`), `rateLimit` (dynamic, `Retry-After`)

## 17. Unified inbox & monetization — Phase 3

- [ ] 17.1 Mini App Tasks screen: aggregated feed of `UnifiedTask` across all connected systems with provider badges
- [ ] 17.2 Custom message templates per subscription
- [ ] 17.3 Pricing tiers and payments via Telegram Stars

## 18. Observability hardening — cross-phase

- [x] 18.1 Emit metrics: webhook delivery success per provider, event→message latency, remaining rate limit per connection, expired-token counter, BullMQ queue depth
- [ ] 18.2 Alerting on DLQ depth and expired-token spikes
