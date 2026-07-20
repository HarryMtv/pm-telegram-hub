## 1. Adapter contract: listTasks

- [x] 1.1 Add `TaskQuery` type (containerId?, assigneeIsMe?, statusCategory?, text?, pagination) to `src/adapters/types.ts`
- [x] 1.2 Add `listTasks(creds, query): Promise<UnifiedTask[]>` to `ProviderAdapter` in `src/adapters/provider-adapter.ts` with doc comments
- [x] 1.3 Implement `listTasks` in `FakeAdapter` (`src/adapters/fake.ts`) covering all filters
- [x] 1.4 Implement `listTasks` in the ClickUp adapter
- [x] 1.5 Implement `listTasks` in the Wrike adapter (also implemented for Jira scaffold to satisfy the contract)
- [x] 1.6 Extend `src/adapters/conformance.test.ts` to cover `listTasks` (container, assignee-is-me, status, text filters)
- [x] 1.7 `pnpm typecheck` and `pnpm test` green for adapter changes

## 2. Shared adapter-runner service

- [x] 2.1 Create `src/services/adapter-runner.ts` extracting the `runWithConn` pattern (decrypt creds, build limiter, `withConnection`) from `src/bot/commands.ts`
- [x] 2.2 Refactor `src/bot/commands.ts` to use the shared `adapter-runner`
- [x] 2.3 Confirm bot tests still pass (`pnpm vitest run src/bot`)

## 3. Backend API routes

- [x] 3.1 `DELETE /api/connections/:id` — verify ownership, deregister webhook (auto-setup) via adapter-runner, delete connection
- [x] 3.2 `GET /api/subscriptions` — add `listSubscriptionsForUser` in `src/db/subscriptions.ts` and route
- [x] 3.3 `DELETE /api/subscriptions/:id` — ownership check + `deleteSubscription` (ownership-scoped `deleteSubscriptionForUser`)
- [x] 3.4 Update `POST /api/subscriptions` to resolve `telegram_chat_id` from the authenticated user (ignore client-supplied chat)
- [x] 3.5 `GET /api/connections/:id/containers?parentId=` — ownership check + adapter `listContainers` via adapter-runner
- [x] 3.6 `GET /api/tasks` — fan out over the user's connections, call `listTasks` in parallel, merge into one feed, apply query filters
- [x] 3.7 `GET /api/tasks/:conn/:id` (`getTask`) and `GET /api/tasks/:conn/:id/statuses` (`getAvailableStatuses`)
- [x] 3.8 `POST /api/tasks/:conn/:id/status` (`setStatus`) and `POST /api/tasks/:conn/:id/comment` (`addComment`)
- [x] 3.9 `POST /api/tasks` (`createTask`)
- [x] 3.10 `GET /api/mappings`, `POST /api/mappings`, `DELETE /api/mappings/:id` (reuse `src/db/mappings.ts`, ownership checks)
- [x] 3.11 Ensure `connectProvider` returns webhook URL + secret for `admin-required` providers (for the onboarding UI)
- [x] 3.12 Route tests: auth guard, `user_id` scoping, ownership rejection for delete/detail routes

## 4. Mini App UI foundation

- [x] 4.1 Add Tailwind (v4 via `@tailwindcss/vite`) to `mini-app/`; configure `tsconfig`/`vite.config` `@/*` alias
- [x] 4.2 `components.json` + core shadcn primitives (button, card, badge, tabs, input, skeleton, sonner); remaining primitives (dialog, sheet, select, accordion, checkbox, switch, scroll-area, avatar) added per-screen in Groups 5–8
- [x] 4.3 Bridge shadcn tokens to Telegram `--tg-theme-*` in `src/index.css`; stamp light/dark from resolved bg luminance
- [x] 4.4 `src/lib/telegram.ts`: init theme, viewport (expand + safe-area), BackButton, MainButton, haptics; export `useMainButton`/`useBackButton` hooks
- [x] 4.5 Add `QueryClientProvider` in `main.tsx` and TanStack Query layer (`src/lib/query.ts`: client, query keys, error toasts)
- [x] 4.6 Bottom-tab router (`src/lib/nav.tsx` + `BottomTabs`) across Connections / Subscriptions / Inbox / Mappings; BackButton-driven detail stack

## 5. Connections screen

- [x] 5.1 Rebuild connection list on shadcn Card/Badge with empty state
- [x] 5.2 Render credential forms from `credentialFields()` on shadcn inputs (mask token/password); per-adapter Connect button (MainButton reserved for single-action detail screens)
- [x] 5.3 Disconnect flow: confirm Dialog → `DELETE /api/connections/:id` → invalidate list
- [x] 5.4 Admin-webhook onboarding dialog for `admin-required` providers (show URL + secret, copy-to-clipboard with haptic)

## 6. Subscriptions screen

- [x] 6.1 List active subscriptions (connection + event types + filters) with delete
- [x] 6.2 Create flow: choose connection → event-type checkboxes (from `EVENT_TYPES`)
- [x] 6.3 Container-tree component (`ContainerTree`) backed by `GET /api/connections/:id/containers`
- [x] 6.4 Save via `POST /api/subscriptions` (MainButton), invalidate list

## 7. Unified Inbox screen

- [x] 7.1 Task feed from `GET /api/tasks`: provider badge, status color by category, due date
- [x] 7.2 Search input + status-category and provider filters
- [x] 7.3 Kanban (Board) view grouped by status category (open/in_progress/done/cancelled)
- [x] 7.4 Task detail card (full screen, BackButton): description, status, open-in-provider link
- [x] 7.5 Status change from card via `.../statuses` + `.../status`
- [x] 7.6 Comment from card via `.../comment`
- [x] 7.7 Create-task form (name + container picker, optional description) via `POST /api/tasks`

## 8. Mappings screen

- [x] 8.1 List mappings (alias → provider/container, default flag) with delete
- [x] 8.2 Create/update mapping: reuse container-tree picker + alias input + default toggle via `POST /api/mappings`

## 9. Verification

- [x] 9.1 `pnpm typecheck`, `pnpm lint`, `pnpm test` green (root, 96 tests); `pnpm --dir mini-app build` + dev server boot succeed
- [ ] 9.2 Manual smoke — REQUIRES LIVE ENV (Telegram client + provider credentials + running backend/Redis/DB): connect → subscribe → inbox list/detail/status/comment → create task → mapping. Not exercisable in this sandbox.
- [x] 9.3 Confirm no core provider-name branching was introduced (iron rule) — only dynamic comparisons against user-supplied provider args remain
