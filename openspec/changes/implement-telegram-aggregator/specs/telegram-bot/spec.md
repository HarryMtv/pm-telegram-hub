# telegram-bot

## ADDED Requirements

### Requirement: Provider-agnostic bot commands
The bot (grammY) SHALL implement `/start`, `/connect <provider> <token>`, `/newtask <name> [#alias]`, `/task <id>`, `/comment <id> <text>`, `/status <id> <status>`, `/assign <id> @user`, `/due <id> <date>`, `/browse`, `/map`, `/subscribe`, `/unsubscribe`, `/help`. All commands are provider-agnostic; with multiple connections the provider is selected via alias (an alias knows its provider) or inline buttons.

#### Scenario: /start
- **WHEN** a user sends `/start`
- **THEN** the bot replies with a greeting and a button that opens the Mini App

#### Scenario: /newtask with alias
- **WHEN** a user sends `/newtask Fix login #dev`
- **THEN** the bot creates the task in the container mapped to alias `dev` (or the default mapping when no alias is given)

### Requirement: Secure /connect
`/connect` SHALL verify credentials via `adapter.verifyCredentials`, store the connection, and delete the user's message (`deleteMessage`) so the token does not remain in chat history. `/connect` supports only single-token providers; providers with complex credentials (Jira) are connected exclusively through the Mini App.

#### Scenario: Successful connect
- **WHEN** a user sends `/connect clickup <token>` with a valid token
- **THEN** the connection is saved and the original message containing the token is deleted

#### Scenario: Complex-credentials provider
- **WHEN** a user attempts `/connect jira ...`
- **THEN** the bot directs them to the Mini App instead of accepting credentials in chat

### Requirement: Inline actions on notifications
Notifications and task cards SHALL carry inline buttons - "Take" (in_progress), "Done" (done), "Comment" (reply flow) - implemented through unified status categories via `getAvailableStatuses` + `setStatus`.

#### Scenario: Done in two seconds
- **WHEN** a user taps "Done" under a notification
- **THEN** the task status changes to the provider status whose category is `done`, without the user opening the provider UI

### Requirement: HTML message formatting
Messages SHALL be rendered in HTML parse mode (escaping only `<`, `>`, `&`), using unified templates identical for all providers with a provider badge, per spec section 6.2.

#### Scenario: Task name with special characters
- **WHEN** a task name contains Markdown-breaking characters
- **THEN** the notification renders correctly because HTML mode is used with proper escaping

### Requirement: Telegram webhook authenticity
In webhook mode the bot SHALL register via `setWebhook(..., { secret_token })` and verify the `X-Telegram-Bot-Api-Secret-Token` header on every update. `BOT_MODE=polling` SHALL be supported for local development.

#### Scenario: Forged update
- **WHEN** an update arrives without the correct secret token header
- **THEN** it is rejected

#### Scenario: Local development
- **WHEN** `BOT_MODE=polling` is set
- **THEN** the bot runs via long polling with no public webhook required

### Requirement: Deep links into Mini App
Notifications SHALL include deep links / `web_app` buttons routing users into the Mini App for multi-step flows; multi-step scenarios are never built in chat.

#### Scenario: Open full card
- **WHEN** a user wants details beyond the notification summary
- **THEN** a deep link opens the corresponding view in the Mini App

