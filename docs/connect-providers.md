# Connecting your work-management provider

This guide walks you through creating an API token for each supported provider
and connecting it to the Telegram bot. Once connected, the bot turns provider
events into Telegram notifications and lets you manage tasks from chat and the
Mini App.

Two ways to connect:

- **`/connect <provider> <token>`** — for single-token providers (ClickUp,
  Wrike). The message containing your token is deleted from the chat right after
  the bot verifies it.
- **Mini App → Connections** — works for every provider and is **required** for
  providers that need more than one credential field (Jira). Open it from the
  `/start` menu.

After connecting, run `/subscribe <provider> me` to start receiving
notifications in the current chat. The `me` flag scopes the subscription to
tasks assigned to you, so you only get events for your own work.

Providers are covered below in this order: **ClickUp → Wrike → Jira**.

---

## ClickUp

ClickUp uses a single **Personal API Token**. The bot registers the webhook for
you automatically — no admin setup required.

### 1. Create a Personal API Token

1. Open ClickUp and go to your API settings:
   **Avatar (bottom-left) → Settings → Apps**, or open the ClickUp API settings
   for your Workspace directly at
   `https://app.clickup.com/<team_id>/settings/team/<team_id>/clickup-api`.
2. Under **API Token**, click **Generate** (or **Regenerate** if one already
   exists).
3. Copy the token — it starts with `pk_`.

> For reference, see ClickUp's own guide: _"Create your own app with the ClickUp
> API"_ in the ClickUp Help Center
> (help.clickup.com → search "Create your own app with the ClickUp API").

### 2. Connect

- **From chat:**
  ```
  /connect clickup pk_12345678_ABCDEFGHIJKLMNOPQRSTUVWXYZ
  ```
  The bot verifies the token, stores it encrypted, registers the webhook, and
  deletes your message.
- **From the Mini App:** open **Connections**, pick **ClickUp**, paste the token
  into **ClickUp Personal Token**, and press **Connect**.

### 3. Subscribe

```
/subscribe clickup me
```

`me` scopes notifications to tasks assigned to you. Drop it (`/subscribe
clickup`) to receive events for every task on the connection.

---

## Wrike

Wrike uses a single **Permanent Access Token**. The bot registers the webhook
for you automatically — no admin setup required.

### 1. Create a Permanent Access Token

1. Open the Wrike **API app console**:
   `https://www.wrike.com/appconsole.htm` → open the **API** section (the
   `#api` tab).
2. Scroll to **Permanent access tokens** and click **Create token**.
3. Confirm, then copy the token — you won't be able to see it again after
   closing the dialog.

> For reference, see Wrike's own guide: _"Wrike API"_ in the Wrike Help Center
> (help.wrike.com → search "Wrike API").

### 2. Connect

- **From chat:**
  ```
  /connect wrike eyJ0eXAiOiJ...your-token...
  ```
  The bot verifies the token, stores it encrypted, completes the Wrike
  registration handshake, registers the webhook, and deletes your message.
- **From the Mini App:** open **Connections**, pick **Wrike**, paste the token
  into **Wrike Permanent Access Token**, and press **Connect**.

### 3. Subscribe

```
/subscribe wrike me
```

`me` scopes notifications to tasks assigned to you. Drop it (`/subscribe
wrike`) to receive events for every task on the connection.

---

## Jira

Jira needs **three** credential fields, so it must be connected through the
**Mini App** — `/connect` won't work. Jira webhooks also require a one-time
**admin setup** in your Jira site; the Mini App shows you the exact URL and
secret to paste after you connect.

### 1. Create an API token

1. Sign in to your Atlassian account and open the API tokens page:
   `https://id.atlassian.com/manage-profile/security/api-tokens`.
2. Click **Create API token**, give it a label (e.g. `telegram-hub`), and set an
   expiry.
3. Copy the token immediately — it's shown only once.

> For reference, see Atlassian's own guide: _"Manage API tokens for your
> Atlassian account"_ in the Atlassian Support site
> (support.atlassian.com → search "Manage API tokens").

You'll also need:

- **Jira site URL** — your Jira base URL, e.g. `https://yourteam.atlassian.net`.
- **Email** — the email of the Atlassian account that owns the token.

### 2. Connect in the Mini App

1. Open the Mini App from the `/start` menu and go to **Connections**.
2. Pick **Jira** and fill in the fields:
   - **Jira site URL** → `https://yourteam.atlassian.net`
   - **Email** → your Atlassian account email
   - **API token** → the token from step 1
3. Press **Connect**.

### 3. Finish webhook setup (admin)

Because Jira webhooks are created in the Jira admin console, after connecting the
Mini App shows a **Finish webhook setup** dialog with a **Webhook URL** and a
**Secret**. In Jira:

1. Go to **Settings (gear) → System → WebHooks** (Jira admin required), then
   **Create a WebHook**.
2. Paste the **Webhook URL** from the dialog into the URL field.
3. Add the **Secret** so Jira signs deliveries (`X-Hub-Signature`, HMAC-SHA256).
4. Select the issue events you want (created, updated, etc.) and save.

Admin webhooks created this way don't expire.

### 4. Subscribe

```
/subscribe jira me
```

`me` scopes notifications to tasks assigned to you. Drop it (`/subscribe
jira`) to receive events for every issue on the connection.

---

## After connecting

- `/subscribe <provider> me` — receive notifications for tasks assigned to you
  in the current chat (drop `me` to get events for all tasks).
- `/status` — list your connections and their state.
- `/unsubscribe [provider]` — stop notifications in this chat.
- Manage everything (connections, subscriptions, tasks) in the **Mini App**.

Full bot command reference: [`docs/bot-commands.md`](bot-commands.md).

### Security notes

- All credentials and webhook secrets are **AES-256-GCM encrypted at rest**; the
  encryption key never leaves the app server.
- The `/connect` message carrying your token is **deleted from the chat** as soon
  as the bot verifies it. Tokens entered in the Mini App are sent over HTTPS and
  never shown again.
- If a token is ever exposed, revoke it in the provider's console and reconnect.
