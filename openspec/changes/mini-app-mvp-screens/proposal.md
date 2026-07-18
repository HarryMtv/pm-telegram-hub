## Why

The Mini App (spec §7.3) is meant to be the app's pull-side surface — onboarding,
subscription setup, a unified task inbox, and container aliases. Today only one of
the four MVP screens exists, and even Connections is partial (no disconnect, no
admin-webhook flow). Subscriptions setup is P0 in the spec but has no UI, and the
Unified Inbox — the product's main differentiation (§8.2) — has neither UI nor a
backend capability to list tasks. This change delivers the four MVP screens with a
native-feeling Telegram UI.

## What Changes

- Add a **UI foundation** to `mini-app/`: Tailwind + shadcn components, full
  `@telegram-apps/sdk-react` integration (theme, viewport/safe-area, BackButton,
  MainButton, haptics), bottom-tab routing, and TanStack Query for all data access.
  shadcn design tokens are bridged onto Telegram `--tg-theme-*` variables so the app
  tracks the client's light/dark theme.
- **Connections**: finish the screen — disconnect a provider (deregisters the
  provider webhook), render credential forms from `credentialFields()` on shadcn
  inputs, and show the admin-webhook onboarding (URL + generated secret) for
  `webhookSetup: 'admin-required'` providers (Jira).
- **Subscriptions**: new screen — pick a connection, choose event types, and select
  container filters from a lazily-expanded container tree. Notifications target the
  user's **personal chat** (Telegram does not expose a user's group chats to the bot).
- **Unified Inbox / Tasks**: new screen — an aggregated feed of `UnifiedTask` across
  all of a user's connections, with search, category filters, a kanban view, a full
  task card (status change, comment, open-in-provider), and task creation.
- **Adapter contract extension** — **BREAKING** for adapters: add `listTasks` to
  `ProviderAdapter`. The core cannot list tasks today (only `getTask`/`listContainers`
  exist), so the inbox requires this. Implemented in ClickUp, Wrike, and FakeAdapter;
  enforced by conformance tests. No core provider-name branching (iron rule).
- **Mappings**: new screen — manage `alias → provider/container` mappings used by
  `/newtask`, reusing the container-tree picker.
- New backend API routes under `/api/*` for the above (connections delete,
  subscriptions list/delete, container tree, tasks list/detail/statuses/actions/create,
  mappings CRUD). Extract the bot's `runWithConn` rate-limit helper into a shared
  service for reuse by these routes.

No database migrations are required (subscriptions/mappings tables already exist).

## Capabilities

### New Capabilities

- `mini-app-ui-foundation`: Tailwind + shadcn setup, Telegram SDK integration
  (theme/viewport/BackButton/MainButton/haptics), bottom-tab routing, and the
  TanStack Query data layer that all screens build on.
- `mini-app-connections`: view connections, disconnect (with webhook deregistration),
  render adapter credential forms, and admin-webhook onboarding for Jira.
- `mini-app-subscriptions`: create/list/delete subscriptions to the personal chat,
  choosing event types and container filters from a lazily-expanded container tree.
- `mini-app-unified-inbox`: aggregated cross-provider task feed with search/filters,
  kanban, task detail (status/comment), and task creation.
- `mini-app-mappings`: manage container aliases used by `/newtask`.
- `adapter-list-tasks`: extend the `ProviderAdapter` contract with `listTasks`
  (filters + pagination), implemented per provider and enforced by conformance tests.

### Modified Capabilities

<!-- No existing OpenSpec specs; all behavior above is introduced as new capabilities. -->

## Impact

- **Code (frontend)**: `mini-app/` — new build config (Tailwind, `components.json`,
  tsconfig/vite aliases), `src/components/ui/`, `src/lib/telegram.ts`, screen
  components, TanStack Query provider, router. Replaces the current single-file
  `Connections.tsx`/`App.tsx` structure.
- **Code (backend)**: `src/adapters/provider-adapter.ts` + `types.ts` (`listTasks`),
  `src/adapters/{clickup,wrike,fake}/` implementations, `src/adapters/conformance.test.ts`,
  new/extended `src/api/routes.ts`, `src/db/subscriptions.ts` (list-for-user),
  new `src/services/adapter-runner.ts` (extracted from `src/bot/commands.ts`).
- **APIs**: new routes `DELETE /api/connections/:id`, `GET/DELETE /api/subscriptions[/:id]`,
  `GET /api/connections/:id/containers`, `GET/POST /api/tasks`,
  `GET /api/tasks/:conn/:id[/statuses]`, `POST /api/tasks/:conn/:id/{status,comment}`,
  `GET/POST/DELETE /api/mappings[/:id]`.
- **Dependencies**: add Tailwind + shadcn primitives (Radix under the hood) to
  `mini-app/`; TanStack Query already present.
- **Contract/adapters**: every `ProviderAdapter` implementation must add `listTasks`
  (breaking for adapters, not for the core). Jira remains scaffolded but the
  admin-webhook UI path is exercised by its `capabilities()`.
- **No DB migrations.**
