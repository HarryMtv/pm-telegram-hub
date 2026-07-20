# mini-app-unified-inbox

## Purpose

The Unified Inbox screen: an aggregated cross-provider task feed with search,
filters, a kanban view, a task detail card (status change, comment), and task
creation.

## Requirements

### Requirement: Aggregated cross-provider task feed

The Inbox screen SHALL show a single feed of `UnifiedTask` items aggregated across all
of the authenticated user's connections. Each item MUST display its provider, name,
status (colored by status category), assignees, and due date when present.

#### Scenario: Tasks from multiple providers

- **WHEN** the user has connections to more than one provider each with tasks
- **THEN** `GET /api/tasks` returns tasks from all of them merged into one feed, each
  labeled with its provider

#### Scenario: Only the user's own connections

- **WHEN** the feed is loaded
- **THEN** it includes tasks only from connections owned by the authenticated user

### Requirement: Search and category filters

The feed SHALL support text search and filtering by status category and by provider.

#### Scenario: Filtering by status category

- **WHEN** the user filters to a status category (e.g., in_progress)
- **THEN** only tasks whose status maps to that category are shown

#### Scenario: Text search

- **WHEN** the user enters a search term
- **THEN** only tasks matching the term are shown

### Requirement: Kanban view

The Inbox SHALL offer a kanban view with columns for the unified status categories
(open, in_progress, done, cancelled).

#### Scenario: Kanban grouping

- **WHEN** the user switches to the kanban view
- **THEN** each task appears in the column matching its status category

### Requirement: Task detail card

Opening a task SHALL show a detail card with its description, current status,
assignees, due date, and a link to open the task in the provider.

#### Scenario: Opening a task

- **WHEN** the user opens a task from the feed
- **THEN** its full detail is fetched via `GET /api/tasks/:conn/:id` and displayed,
  including a link that opens the task in the provider

### Requirement: Change task status from the card

From the task card the user SHALL change the task's status by selecting from the
statuses available for that task.

#### Scenario: Setting a new status

- **WHEN** the user selects an available status on a task
- **THEN** the available statuses come from `GET /api/tasks/:conn/:id/statuses`, and
  choosing one sets it via `POST /api/tasks/:conn/:id/status` and the card reflects the
  new status

### Requirement: Comment on a task

From the task card the user SHALL add a comment to the task.

#### Scenario: Adding a comment

- **WHEN** the user submits comment text on a task
- **THEN** it is posted via `POST /api/tasks/:conn/:id/comment`

### Requirement: Create a task

The user SHALL create a task by choosing a connection and container and providing a
name, with optional fields when the provider supports them.

#### Scenario: Creating a task

- **WHEN** the user submits a task name and a target container
- **THEN** the task is created via `POST /api/tasks` and appears in the feed
