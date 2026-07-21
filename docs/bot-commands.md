# Telegram Bot — Commands

The bot surfaces provider events (ClickUp, Wrike; Jira in Phase 3) as
notifications and lets you act on tasks straight from chat. All text the bot
sends is in **English**.

`<provider>` is one of `clickup`, `wrike`, `jira` (lowercase). Where a command
accepts an optional `[provider]`, it defaults to your only connection — if you
have several, you must specify it.

## Connections & subscriptions

| Command        | Parameters           | Description                                                                                                                                     |
| -------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/connect`     | `<provider> <token>` | Verify the token, persist the connection (encrypted), register the provider webhook. **The message containing the token is deleted from chat.** |
| `/subscribe`   | `[provider] [me]`    | Subscribe this chat to notifications. Idempotent. `me` = only tasks **assigned to you** (resolves your provider user id once).                  |
| `/unsubscribe` | `[provider]`         | Remove this chat's subscriptions for the connection(s).                                                                                         |
| `/start`       | —                    | Greeting + button to open the Mini App.                                                                                                         |
| `/help`        | —                    | Quick command reference.                                                                                                                        |

Examples:

```
/connect clickup pk_...
/subscribe                 # all events on all connections
/subscribe me              # only tasks assigned to you
/subscribe wrike me        # only your tasks, Wrike only
/unsubscribe
```

> Providers that need several credential fields (Jira: `baseUrl`, `email`,
> `apiToken`) are connected through the **Mini App**, not `/connect`.

## Task management

| Command    | Parameters                                   | Description                                                                                                                     |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/newtask` | `<name> [#alias]`                            | Create a task. With `#alias` it goes to that mapped container; otherwise to your default container (set with `/map … default`). |
| `/task`    | `[provider] <id>`                            | Show a task card with inline buttons.                                                                                           |
| `/comment` | `[provider] <id> <text>`                     | Add a comment.                                                                                                                  |
| `/status`  | `[provider] <id> <status>`                   | Change status. `<status>` is a status name or a keyword: `done`, `in-progress`, `open`, `cancel`.                               |
| `/assign`  | `[provider] <id> @userId`                    | Add an assignee (provider user id; the leading `@` is optional).                                                                |
| `/due`     | `[provider] <id> <date>`                     | Set the due date.                                                                                                               |
| `/browse`  | `[provider]`                                 | List containers (spaces/folders/lists) to find ids.                                                                             |
| `/map`     | `<alias> <containerId> [provider] [default]` | Create an alias → container mapping used by `/newtask`. Add `default` to make it the default for the provider.                  |

Examples:

```
/browse                       # find a list id
/map inbox 869e5gd48 default  # alias "inbox" → list 869e5gd48 (default)
/newtask Fix the login #inbox
/task 869e5gd48
/status 869e5gd48 done
/comment 869e5gd48 looks good, shipping it
/assign 869e5gd48 @302663612
/due 869e5gd48 2026-08-01
```

## Inline buttons

Buttons appear under notifications and `/task` cards:

| Button         | Action                                    |
| -------------- | ----------------------------------------- |
| 💪 **Take**    | Move the task to an `in_progress` status. |
| ✅ **Done**    | Move the task to a `done` status.         |
| 💬 **Comment** | Hint to use `/comment <id> <text>`.       |
| ↩️ **Reply**   | _(comments only)_ Open a reply prompt.    |

These act through **unified status categories** — no provider-specific code in
the core.

### Reply (mention the author in the provider)

Under a **comment** notification, ↩️ **Reply** asks for your text and posts a
provider comment that **@mentions the original author** (a real ping, e.g. a
ClickUp `tag`). The mention uses the author's provider user id captured from the
event, so it works without a separate user mapping. Currently implemented for
ClickUp.

## Behavior notes

- **Self-echo suppression (on by default).** Events you triggered yourself — via
  the bot or directly in the provider — are **not** echoed back to you. You only
  see what others do. (Applies per connection owner; the bot already acknowledged
  your own actions.)
- **Duplicate events collapsed.** Providers like ClickUp fire both a generic
  `taskUpdated` and a specific event (status/comment/…) for one change; the
  adapter drops the redundant generic one so you get a single notification.
- **Idempotent delivery.** Re-delivered webhooks never produce duplicate messages
  (`unique(subscription_id, dedupe_key)`).
