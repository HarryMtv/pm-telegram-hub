# mini-app

## Purpose

The Telegram Mini App: initData authentication and the Connections, Subscriptions, Tasks, and Mappings screens over unified models.

## Requirements

### Requirement: initData authentication

The Mini App SHALL authenticate by sending Telegram `initData` to the backend, which validates the signature (HMAC-SHA256 with key `HMAC_SHA256("WebAppData", BOT_TOKEN)`), checks `auth_date` freshness (window ~1 hour), and issues a short-lived Supabase-compatible JWT with a `telegram_id` claim.

#### Scenario: Valid initData

- **WHEN** the Mini App submits valid, fresh initData
- **THEN** the backend returns a short-lived JWT usable for API calls and direct Supabase access under RLS

#### Scenario: Stale or forged initData

- **WHEN** initData fails signature validation or `auth_date` is outside the window
- **THEN** authentication is rejected

### Requirement: Connections screen

The Connections screen SHALL let users connect/disconnect providers with credential forms rendered from adapter metadata (single token for ClickUp/Wrike; site + email + API token for Jira), select a workspace, and - when `webhookSetup: 'admin-required'` - show step-by-step admin instructions with the webhook URL and a generated secret.

#### Scenario: Connect ClickUp

- **WHEN** a user connects ClickUp in the Mini App
- **THEN** they enter a token in a form (never in chat), pick a workspace, and the webhook is registered automatically

#### Scenario: Connect Jira (Phase 3)

- **WHEN** a user connects Jira
- **THEN** the app shows the admin webhook instruction (URL + generated secret + event list + optional JQL filter)

### Requirement: Subscriptions screen

The Subscriptions screen SHALL configure chats x event types x container filters, with the container tree rendered from `listContainers`.

#### Scenario: Scoped subscription

- **WHEN** a user selects a chat, a subset of event types, and specific containers
- **THEN** only matching events produce notifications in that chat

### Requirement: Unified inbox

The Tasks screen SHALL show an aggregated feed of `UnifiedTask` items across all connected systems (Phase 3 differentiator).

#### Scenario: Two providers connected

- **WHEN** a user has ClickUp and Wrike connections
- **THEN** the inbox shows tasks from both in one list with provider badges

### Requirement: Mappings screen

The Mappings screen SHALL manage container aliases used by `/newtask` (alias -> container, optional default).

#### Scenario: Create alias

- **WHEN** a user maps alias `dev` to a container
- **THEN** `/newtask <name> #dev` creates tasks in that container

### Requirement: Mini App platform requirements

The Mini App SHALL be built with React 18 + TypeScript + Vite using `@telegram-apps/sdk-react` (theme, viewport, BackButton, MainButton) and TanStack Query, served over HTTPS via nginx.

#### Scenario: Theme adaptation

- **WHEN** the user's Telegram theme is dark
- **THEN** the Mini App renders with matching theme variables
