# mini-app-task-comments

## Purpose

Display a task's comment thread in the Task Detail screen of the Telegram Mini App,
rendered immediately after the description, with fetch, loading/empty states, and refresh
after posting — over the unified `Comment` model.

## ADDED Requirements

### Requirement: Comments API endpoint

The core SHALL expose `GET /api/tasks/:connectionId/:taskId/comments` returning
`{ comments: Comment[] }`, scoped to the connection owner via the existing user and
ownership guards, and resolved through the per-connection rate limiter.

#### Scenario: Owner fetches the thread

- **WHEN** the connection owner requests the comments for their task
- **THEN** the endpoint returns the task's comments as unified `Comment[]` in
  chronological order

#### Scenario: Non-owner is rejected

- **WHEN** a user requests comments for a connection they do not own
- **THEN** the endpoint rejects the request with the same authorization error as the other
  `:connectionId` task routes

### Requirement: Task Detail shows the comment thread

The Task Detail screen SHALL fetch and render the task's comments in a Comments card
placed directly after the description. Comment bodies MUST wrap long text without
horizontal overflow. The screen MUST show a loading state while fetching and an empty
state when there are no comments.

#### Scenario: Viewing a task with comments

- **WHEN** the user opens Task Detail for a task that has comments
- **THEN** the comments are rendered after the description in chronological order, with
  author and timestamp, and long links wrap within the card

#### Scenario: Viewing a task with no comments

- **WHEN** the user opens Task Detail for a task with no comments
- **THEN** an empty state is shown in the Comments card

#### Scenario: Comments are loading

- **WHEN** the comment thread is being fetched
- **THEN** a loading placeholder is shown until the thread resolves

### Requirement: Posting a comment refreshes the thread

After a comment is posted through the existing composer, the Task Detail screen SHALL
refresh the comment list so the new comment appears without a manual reload.

#### Scenario: Newly posted comment appears

- **WHEN** the user posts a comment successfully
- **THEN** the comment list is refreshed and the new comment appears in the thread
