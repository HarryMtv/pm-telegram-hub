## Context

The Mini App (`mini-app/`, React 18/19 + Vite + `@telegram-apps/sdk-react`) currently
has one partial screen (`Connections`) and a hand-rolled `fetch` layer. The backend
core operates only on unified models and resolves providers through `registry.get()`;
all provider-specific knowledge lives in adapters (the iron rule in CLAUDE.md). Four
MVP screens are specified (§7.3): Connections, Subscriptions, Unified Inbox, Mappings.

Constraints:
- Iron rule: the core must never branch on a provider name. The inbox needs task
  listing, which the adapter contract does not provide today.
- Telegram does not expose a user's group chats to the bot, so subscription targets
  are limited to the user's personal chat for this change.
- The Mini App is served same-origin from Fastify static (recent commit), so no CORS
  is required in production; dev uses the Vite proxy in `vite.config.ts`.
- Auth is Telegram `initData` → app JWT; API repositories are scoped by `user_id`.

## Goals / Non-Goals

**Goals:**
- Deliver the four MVP screens with a native-feeling, theme-aware Telegram UI built on
  shadcn components.
- Extend the adapter contract with `listTasks` so the Unified Inbox works without any
  provider-name branching in the core.
- Reuse existing DB/service/adapter machinery (subscriptions/mappings repos,
  `withConnection` rate-limit context) rather than duplicating it.

**Non-Goals:**
- Group-chat subscription targets, chat discovery, or a `known_chats` table.
- Phase-3 "misc" features: quiet hours, message templates, digest batching, language,
  monetization / Telegram Stars, deep links from notifications.
- Jira going live — it stays scaffolded; only its `admin-required` webhook UI path is
  exercised.
- Any database migration (existing tables suffice).

## Decisions

### 1. Extend `ProviderAdapter` with `listTasks`

Add `listTasks(creds, query): Promise<UnifiedTask[]>` plus a `TaskQuery` type
(`containerId?`, `assigneeIsMe?`, `statusCategory?`, `text?`, pagination) to
`src/adapters/types.ts` and `provider-adapter.ts`. Implement in ClickUp and Wrike;
add to `FakeAdapter`; extend `conformance.test.ts`.

- **Why**: The inbox is the product's main differentiation and cannot be built from
  `getTask`/`listContainers` alone. Per the iron rule, the capability must live in the
  contract, not as core-side special casing.
- **Alternative rejected**: Deriving an inbox from stored notification history — that
  is a delivery log, not the current task state, and would drift.

### 2. Shared `adapter-runner` service

Extract the bot's `runWithConn` helper (`src/bot/commands.ts:59`) into
`src/services/adapter-runner.ts`: given a connection row, decrypt credentials, build
the rate limiter, and run an adapter call inside `withConnection`. New API routes
(tasks, containers, disconnect) call it; `bot/commands.ts` is refactored to use it.

- **Why**: The container-tree, task, and disconnect routes all need the same
  rate-limited adapter-call pattern the bot already has. One helper avoids drift.
- **Alternative rejected**: Duplicating the pattern in `api/routes.ts` — divergence
  risk on rate-limit handling.

### 3. Personal-chat-only subscriptions

`POST /api/subscriptions` resolves `telegram_chat_id` on the backend from the
authenticated user's Telegram id (`getUserByTelegramId`), ignoring any client-supplied
chat. The UI drops the chat-selection step.

- **Why**: Telegram gives the bot no list of the user's groups; a private chat is the
  only reliably addressable target. Keeps the P0 screen shippable now.
- **Alternative deferred**: `known_chats` populated from bot group events — larger
  scope, revisit when group digests (Phase 2 P1) land.

### 4. UI foundation: Tailwind + shadcn bridged to Telegram theme

Install Tailwind + shadcn in `mini-app/`; define shadcn tokens
(`--background`, `--foreground`, `--primary`, …) in `index.css` as `var(--tg-theme-*)`
with fallbacks, and stamp light/dark from the SDK `colorScheme`/`themeParams`.
Centralize SDK usage in `src/lib/telegram.ts` (theme, viewport/safe-area, BackButton,
MainButton, haptics) exposing hooks (`useMainButton`, `useBackButton`). Routing is a
bottom tab bar; TanStack Query (already a dependency) becomes the data layer with a
thin wrapper over the existing `api()`.

- **Why**: shadcn gives accessible, consistent primitives fast; bridging to
  `--tg-theme-*` makes it look native and track the client theme automatically.
- **Alternative rejected**: Hand-rolled CSS (current approach) — slower to build four
  screens and inconsistent.

### 5. New API surface, all `user_id`-scoped

Add routes: `DELETE /api/connections/:id`; `GET /api/subscriptions`,
`DELETE /api/subscriptions/:id`; `GET /api/connections/:id/containers`;
`GET/POST /api/tasks`, `GET /api/tasks/:conn/:id`, `.../statuses`,
`POST .../status`, `.../comment`; `GET/POST /api/mappings`, `DELETE /api/mappings/:id`.
Each reuses `requireUserId` and verifies resource ownership before acting.
`GET /api/tasks` fans out over the user's connections and merges results.

- **Why**: Mirrors existing route conventions in `src/api/routes.ts`; ownership checks
  preserve the per-user isolation invariant.

## Risks / Trade-offs

- **Adapter breaking change** → All adapters (ClickUp, Wrike, Fake) must implement
  `listTasks` in the same change; conformance tests enforce it so nothing ships half-done.
- **`listTasks` fan-out latency/rate limits** across many connections → fan out in
  parallel, cap page size, and rely on the per-connection rate limiter; degrade
  gracefully if one provider errors (surface partial results).
- **Personal-chat-only** limits usefulness for teams → documented Non-Goal; the
  backend resolves the chat so adding group targets later is a route/UI change, not a
  data migration.
- **shadcn/Tailwind added to `mini-app/`** increases bundle size → tree-shaken
  components, only the primitives listed; acceptable for an in-Telegram app.
- **Provider capability gaps** (assignees/priority on create; ADF descriptions) →
  optional fields render only when the adapter/provider supports them; inbox shows
  plain-text descriptions per the unified model.

## Migration Plan

1. Land the adapter contract change (`listTasks` + implementations + conformance) so
   the backend stays green independent of the UI.
2. Add backend API routes (+ `adapter-runner` extraction) with tests.
3. Build the UI foundation (Tailwind/shadcn/SDK/router/query), then screens B→C→D→E.
4. No DB migration. Rollback = revert the change; adapters simply lose an unused method
   and the new routes/screens disappear. Existing `/connect`, `/subscribe`, and
   notification flows are untouched.

## Open Questions

- Workspace selection in Connections: current `connectProvider` sets `scope_id` from
  `verifyCredentials`. Do any of ClickUp/Wrike expose multiple workspaces per token
  that warrant an explicit picker, or is auto-scope sufficient for this change?
  (Assumed sufficient unless proven otherwise.)
- `listTasks` default sort/pagination contract (updated-desc + cursor vs. offset) —
  finalize when implementing the first adapter.
