# provider-adapters

## ADDED Requirements

### Requirement: Unified ProviderAdapter contract
The system SHALL define a `ProviderAdapter` interface that fully encapsulates provider-specific behavior. The core (webhook endpoint, worker, notifier, bot, Mini App) MUST operate only on unified models (`UnifiedEvent`, `UnifiedTask`, `Container`, `StatusDef`) and MUST NOT contain provider-conditional logic (no `if provider === ...`).

#### Scenario: Core is provider-agnostic
- **WHEN** a new feature is added to the core
- **THEN** it works for every registered adapter without referencing a provider name

#### Scenario: New provider added
- **WHEN** a new provider adapter is registered in the adapter registry
- **THEN** webhooks, notifications, bot commands, and Mini App screens work for it without core changes

### Requirement: Opaque provider credentials
The system SHALL treat provider credentials as an opaque object (`ProviderCredentials = Record<string, string>`) whose shape is known only to the adapter. ClickUp/Wrike use `{ token }`; Jira uses `{ baseUrl, email, apiToken }`. The core MUST store and pass credentials without interpreting them.

#### Scenario: Credential verification
- **WHEN** a user submits credentials for a provider
- **THEN** the core calls `adapter.verifyCredentials(creds)` and receives `AccountInfo` (including `scope_id`) without knowing the credential shape

### Requirement: Adapter capabilities descriptor
Each adapter SHALL expose `capabilities()` returning `{ webhookSetup: 'auto' | 'admin-required', webhookLifetimeDays?, payload: 'rich' | 'minimal' }` so the core can adapt behavior (onboarding UI, refresh jobs, enrich skipping) without provider conditionals.

#### Scenario: Admin-required webhook setup
- **WHEN** an adapter reports `webhookSetup: 'admin-required'`
- **THEN** the Mini App shows a step-by-step admin instruction (URL, generated secret, event list) instead of auto-registering the webhook

#### Scenario: Rich payload skips enrichment
- **WHEN** an adapter reports `payload: 'rich'`
- **THEN** the worker treats `enrichEvent` as a no-op and performs no additional provider API calls

### Requirement: Event parsing always returns an array
`parseEvents(payload, headers)` SHALL always return `UnifiedEvent[]`. It MUST accept headers because some providers carry delivery identifiers there (e.g. Jira `X-Atlassian-Webhook-Identifier`).

#### Scenario: Wrike batch
- **WHEN** Wrike delivers multiple events in one HTTP request
- **THEN** `parseEvents` returns one `UnifiedEvent` per batched event

#### Scenario: Single ClickUp event
- **WHEN** ClickUp delivers one event per request
- **THEN** `parseEvents` returns an array with a single element

### Requirement: Stable dedupe keys
Each adapter SHALL construct a stable `dedupeKey` per unified event. ClickUp: `event + ':' + history_items[].id`; Wrike: `eventType + ':' + taskId + ':' + lastUpdatedDate` (plus status ids for status events); fallback in both cases: sha256 of the payload element.

#### Scenario: Redelivered webhook
- **WHEN** a provider retries a webhook delivery
- **THEN** the resulting events carry the same `dedupeKey` values as the original delivery

### Requirement: Webhook lifecycle managed by adapter
Adapters SHALL implement `registerWebhook`, `deleteWebhook`, and optionally `refreshWebhook` and `handleHandshake`. The source of the webhook secret is encapsulated: ClickUp returns it on creation; for Wrike/Jira the system generates it.

#### Scenario: Wrike handshake
- **WHEN** Wrike sends a registration request with the `X-Hook-Secret` header
- **THEN** `handleHandshake` returns a response echoing that header and the endpoint returns it without queueing a job

#### Scenario: ClickUp registration
- **WHEN** the ClickUp adapter registers a webhook via `POST /team/{team_id}/webhook`
- **THEN** the provider-issued secret is stored encrypted in the `webhooks` table

### Requirement: Signature verification over raw body
`verifyWebhook(rawBody, headers, secret)` SHALL compute HMAC over the original raw request bytes, never over re-serialized JSON. ClickUp: HMAC-SHA256 in `X-Signature`; Wrike: HMAC-SHA256 in `X-Hook-Secret`; Jira: `X-Hub-Signature` in `sha256=<hex>` format.

#### Scenario: Invalid signature
- **WHEN** a webhook arrives whose signature does not match the stored secret
- **THEN** the request is rejected and no job is enqueued

### Requirement: Unified event type mapping
Adapters SHALL map provider events onto the unified event types: `task.created`, `task.updated`, `task.deleted`, `task.assigned`, `task.status_changed`, `task.due_changed`, `comment.added`, per the mapping tables in the spec (ClickUp section 4.1, Wrike section 4.2, Jira section 4.3).

#### Scenario: ClickUp status update
- **WHEN** ClickUp sends `taskStatusUpdated`
- **THEN** the adapter emits a `task.status_changed` unified event

#### Scenario: Wrike title change
- **WHEN** Wrike sends `TaskTitleChanged`
- **THEN** the adapter emits a `task.updated` unified event

### Requirement: Unified container navigation
`listContainers(creds, parentId?)` SHALL map the provider hierarchy onto the unified `Container` tree (`kind: root | space | folder | tasklist`, `canContainTasks`). ClickUp: only `tasklist` can contain tasks; Wrike: every folder can.

#### Scenario: Browsing ClickUp
- **WHEN** the core lists containers for a ClickUp connection
- **THEN** it receives team → space → folder → list as a `Container` tree with `canContainTasks: true` only on lists

### Requirement: Status changes via unified categories
`getAvailableStatuses(creds, taskId)` SHALL return statuses per task (not per container) mapped onto categories `open | in_progress | done | cancelled`. Wrike maps `customStatuses[].group` (Active/Completed/Deferred/Cancelled) to `in_progress/done/open/cancelled`.

#### Scenario: Done button
- **WHEN** a user taps the "Done" inline button under a notification
- **THEN** the core calls `getAvailableStatuses(taskId)`, picks the status with `category: 'done'`, and calls `setStatus` - with zero provider-specific code in the core

### Requirement: Task actions
Adapters SHALL implement `createTask`, `updateTask`, `setStatus`, `addComment`, `getTask` using the provider endpoints defined in the spec (ClickUp: `POST /list/{list_id}/task`, `PUT /task/{id}`, `POST /task/{id}/comment`; Wrike: `POST /folders/{folderId}/tasks`, `PUT /tasks/{id}`, `POST /tasks/{id}/comments`).

#### Scenario: Create task via bot
- **WHEN** the core calls `createTask` with a `CreateTaskInput` and container id
- **THEN** the adapter creates the task and returns a `TaskRef` with the provider task id and URL

### Requirement: Per-connection rate limiting
`rateLimit(connection)` SHALL return the rate-limit configuration for a connection: fixed rpm (ClickUp per plan, default 100 rpm) or dynamic with mandatory `Retry-After` compliance on 429. Provider API calls MUST go through the connection owner's limiter.

#### Scenario: 429 response
- **WHEN** a provider returns HTTP 429 with `Retry-After`
- **THEN** the adapter honors the delay before retrying

