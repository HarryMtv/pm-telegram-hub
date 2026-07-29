## Why

The Task Detail screen lets a user *post* a comment but never shows the existing
thread — there is no way to read what's already on a task. Posting is a dead end:
the user can't see their own message, prior replies, or context. Rendering the task's
comment thread (immediately after the description) closes the loop and makes task
detail a usable collaboration surface.

To display comments we also need a way to fetch them. Today the adapter contract only
has `addComment` (write); there is no read path. This change adds that read capability
across the contract, the unified model, the API, and the UI — the same shape already
used for task listing.

## What Changes

- New unified `Comment` model (author, body, createdAt) in `src/models/unified.ts`.
- Extend the `ProviderAdapter` contract with
  `listComments(connection, taskId): Promise<Comment[]>` — the read counterpart to the
  existing `addComment`. Implemented for ClickUp, Wrike, Jira, and `FakeAdapter`
  (so the conformance suite stays green).
- New API route `GET /api/tasks/:connectionId/:taskId/comments` returning the thread,
  scoped to the connection owner (same `requireUser`/`ownedConnection` guard as the
  other task routes).
- Mini App: Task Detail fetches and renders the comment thread right after the
  description; the existing composer refreshes the list on a successful post.
- Comment bodies render with long-text wrapping (`break-words` / `min-w-0`) consistent
  with the description and title fixes already in place.
- No database schema change — comments are read live from the provider on demand, the
  same way task detail is fetched (no comment cache row).
- No breaking changes.

## Capabilities

### New Capabilities

- `adapter-list-comments`: Read path for task comments — the unified `Comment` model,
  the `ProviderAdapter.listComments` contract method, per-provider implementations, and
  the `GET /api/tasks/:connectionId/:taskId/comments` route. Mirrors `adapter-list-tasks`.

- `mini-app-task-comments`: Displaying a task's comment thread in the Task Detail screen
  after the description — fetch (TanStack Query), loading/empty states, and refresh after
  posting via the existing composer.

### Modified Capabilities

<!-- None. The read method is a new contract operation (like list-tasks was), and the
     comment UI is a new task-detail feature with no pre-existing spec. -->

## Impact

- **Adapter contract** (`src/adapters/provider-adapter.ts`, `src/adapters/types.ts`) —
  new `listComments` method + `Comment`/`CommentListOptions` types; implemented in
  ClickUp, Wrike, Jira adapters and `FakeAdapter`; covered by `conformance.test.ts`.
- **Unified models** (`src/models/unified.ts`) — new `Comment`.
- **API** (`src/api/routes.ts`) — new GET route; resolved through `adapter-runner` so
  provider HTTP goes through the per-connection rate limiter.
- **Mini App** (`mini-app/src/screens/TaskDetail.tsx`, `mini-app/src/lib/query.ts`,
  `mini-app/src/lib/types.ts`) — query key, `Comment` client type, fetch + render.
- **Provider endpoints** consumed: ClickUp `GET /task/{id}/comment`, Wrike
  `GET /tasks/{id}/comments`, Jira `GET /rest/api/3/issue/{id}/comment`.
- No DB migration, no breaking API change, no notification-path change (the existing
  `comment.added` notifier behavior is untouched).
