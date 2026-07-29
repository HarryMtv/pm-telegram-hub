## Context

Task Detail today fetches a task live from the provider (`GET /api/tasks/:connectionId/:taskId`
→ `adapter.getTask`) and lets the user post a comment (`adapter.addComment` →
`POST .../comment`). There is no read path for comments, so the thread is invisible in
the Mini App. This change adds the read path end-to-end, following the exact pattern
already established for task listing (`adapter-list-tasks` + `mini-app-unified-inbox`):
a unified model, a contract method, per-provider implementations, an API route, and a
UI consumer.

The core operates only on unified models (the iron rule); the read capability is
provider-specific knowledge that lives exclusively in adapters.

## Goals / Non-Goals

**Goals:**

- A unified `Comment` model and a `ProviderAdapter.listComments` read method, implemented
  for ClickUp, Wrike, Jira, and `FakeAdapter` (conformance).
- A scoped `GET /api/tasks/:connectionId/:taskId/comments` route that runs through the
  per-connection rate limiter.
- A comments thread rendered in Task Detail right after the description, with
  loading/empty states and refresh after posting.

**Non-Goals:**

- No persistence of comments in the DB (read live on demand, like task detail).
- No cursor pagination / infinite scroll in v1 (an optional `limit` is enough).
- No rich-text rendering — comment bodies are plain text.
- No change to `comment.added` notifications (already shipped).
- No bot-surface comment reading.

## Decisions

**1. Unified `Comment` shape — plain text, minimal.**
`{ id, authorName, authorId?, body, createdAt }`. Bodies are plain text for consistency
with notification previews. *Alternative considered:* preserve provider rich text
(ClickUp text, Jira ADF, Wrike markdown) — rejected; mixed renderers add complexity and
the rest of the app is plain-text. Jira ADF is flattened to text inside the Jira adapter
(iron-rule compliant: provider-specific parsing stays in the adapter).

**2. Contract method mirrors `listTasks`.**
`listComments(connection: Connection, taskId: string, opts?: CommentListOptions): Promise<Comment[]>`,
where `CommentListOptions { limit?: number }`. Returns an array always (like `parseEvents`
/ `listTasks`). *No `AdapterCapabilities` flag* — all current providers support comment
reads, mirroring how `listTasks` is universal. A capability flag is only added later if a
provider genuinely cannot list comments.

**3. Live fetch, no DB cache.**
The route calls `listComments` through `adapter-runner` (same `runWithConnection` path as
statuses/comments-write), so provider HTTP is rate-limited per connection. Comments are
not stored. *Alternative considered:* cache rows + TTL invalidation — rejected; adds
schema + invalidation for low read volume. Client-side `staleTime` prevents refetch spam
within a session.

**4. API route shape.**
`GET /api/tasks/:connectionId/:taskId/comments` → `{ comments: Comment[] }`, guarded by
the existing `requireUser` + `ownedConnection` (same as the other `:connectionId` routes).
Ordered chronologically ascending (oldest first), the natural reading order.

**5. Mini App placement — co-locate read + write right after the description.**
Introduce a single **Comments** card immediately after the task-detail card (so it sits
directly under the description), containing the thread list on top and the existing
composer below it. The "Change status" card moves under it. *Alternative considered:*
keep the composer in its own detached card and add a read-only list — rejected; splitting
read and write across cards is worse UX. Moving the composer is the cohesive choice.

**6. Rendering robustness.**
Comment bodies use `whitespace-pre-wrap break-words` and `min-w-0` in flex rows, matching
the description/title fixes already applied — long links won't overflow.

## Risks / Trade-offs

- **Provider hit on every Task Detail open** → mitigated by per-connection rate limiter
  and a client `staleTime`; acceptable for the expected volume.
- **Jira ADF → plain text is lossy** (formatting/mentions stripped) → accepted; rich
  rendering is an explicit Non-Goal.
- **Large threads** → v1 returns the provider's default page bounded by `limit` (default
  50). Full pagination deferred.
- **Author name not always available** (some providers return only a user id) → adapter
  resolves the name when cheap, otherwise falls back to the id or "Unknown". Documented
  trade-off, not a blocker.
- **Posting then seeing it** → on successful `addComment`, invalidate the comments query
  so the new comment appears without a manual refresh.

## Migration Plan

Additive only — new model, new contract method, new GET route, new UI. No migration, no
breaking change. Rollback is reverting the route + UI; adapters simply gain an unused
method.

## Open Questions

- Default `limit` — propose 50; confirm.
- Ordering — propose chronological (oldest first); confirm if newest-first is preferred.
