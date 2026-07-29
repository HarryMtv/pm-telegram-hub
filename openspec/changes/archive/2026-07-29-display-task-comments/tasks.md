# Tasks

## 1. Unified model & adapter contract

- [x] 1.1 Add `Comment` type (`id`, `authorName`, `authorId?`, `body`, `createdAt`) to `src/models/unified.ts`
- [x] 1.2 Add `CommentListOptions { limit?: number }` and `listComments(connection, taskId, opts?)` returning `Promise<Comment[]>` to the `ProviderAdapter` interface in `src/adapters/provider-adapter.ts`

## 2. Per-provider implementations & conformance

- [x] 2.1 Implement `listComments` in the ClickUp adapter (`GET /task/{id}/comment` → unified)
- [x] 2.2 Implement `listComments` in the Wrike adapter (`GET /tasks/{id}/comments` → unified)
- [x] 2.3 Implement `listComments` in the Jira adapter (`GET /rest/api/3/issue/{id}/comment`, flatten ADF to plain text → unified)
- [x] 2.4 Implement `listComments` in `FakeAdapter`
- [x] 2.5 Extend `src/adapters/conformance.test.ts` to cover `listComments`, including the `limit` option

## 3. API route

- [x] 3.1 Add `GET /api/tasks/:connectionId/:taskId/comments` to `src/api/routes.ts` — guarded by `requireUser` + `ownedConnection`, resolved through `runWithConnection`, returning `{ comments: Comment[] }`
- [x] 3.2 Add route coverage to `src/api/routes.test.ts` (owner succeeds; non-owner is rejected)

## 4. Mini App data layer

- [x] 4.1 Add the `Comment` client type to `mini-app/src/lib/types.ts`
- [x] 4.2 Add `qk.taskComments(connectionId, taskId)` to `mini-app/src/lib/query.ts`

## 5. Mini App UI

- [x] 5.1 Fetch comments in `TaskDetail` via `useQuery` keyed on `qk.taskComments`, with a `staleTime` to avoid refetch spam
- [x] 5.2 Add a Comments card directly after the description with: loading skeleton, empty state, and the thread in chronological order (author + timestamp); bodies use `whitespace-pre-wrap break-words` and `min-w-0` so long links don't overflow
- [x] 5.3 Move the existing composer into the Comments card (below the list); on successful `addComment`, invalidate `qk.taskComments` so the new comment appears without a manual reload

## 6. Verification

- [x] 6.1 `pnpm typecheck` and `pnpm lint` (root and `mini-app/`)
- [x] 6.2 `pnpm test` (conformance, routes, and adapter suites)
- [ ] 6.3 Manual check: open Task Detail, read the thread, post a comment, confirm it refreshes and long links wrap within the card
