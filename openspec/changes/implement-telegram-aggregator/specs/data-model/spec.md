# data-model

## ADDED Requirements

### Requirement: Provider-agnostic schema
The Supabase (PostgreSQL) schema SHALL contain the tables `users`, `provider_connections`, `webhooks`, `mappings`, `subscriptions`, `notification_log` as defined in spec section 3, with no provider-specific columns - provider-dependent data lives in `provider` text columns and `jsonb` fields.

#### Scenario: Adding a provider requires no migration
- **WHEN** a new provider adapter is introduced
- **THEN** no schema migration is required; new rows simply use the new `provider` value

### Requirement: User identity is Telegram
`users` SHALL be keyed by `telegram_id bigint not null unique`; users authenticate through Telegram, not Supabase Auth.

#### Scenario: First contact
- **WHEN** a Telegram user interacts with the bot or Mini App for the first time
- **THEN** a `users` row is created from their Telegram identity

### Requirement: Encrypted credentials and secrets at rest
`provider_connections.credentials` (opaque JSON) and `webhooks.secret` SHALL be encrypted with AES-256-GCM on the application side (`node:crypto`), with a unique IV per record, stored as `iv:tag:ciphertext` (base64). The key comes from `ENCRYPTION_KEY` (32-byte hex) and MUST never be sent to the database.

#### Scenario: Database leak
- **WHEN** database contents are exposed
- **THEN** provider tokens and webhook secrets remain unreadable without `ENCRYPTION_KEY`

#### Scenario: Encrypt on write
- **WHEN** a connection or webhook is stored
- **THEN** plaintext credentials/secrets never reach the database

### Requirement: Uniqueness constraints
The schema SHALL enforce: `unique(user_id, provider, scope_id)` on `provider_connections`; `unique(provider, provider_webhook_id)` on `webhooks`; `unique(user_id, provider, alias)` on `mappings`; `unique(connection_id, telegram_chat_id)` on `subscriptions`; `unique(subscription_id, dedupe_key)` on `notification_log`.

#### Scenario: Repeated /subscribe
- **WHEN** a chat subscribes twice to the same connection
- **THEN** the unique constraint prevents a duplicate subscription (idempotent subscribe)

### Requirement: Data isolation
The backend service uses the Supabase service key (bypassing RLS), so every service query SHALL filter by `user_id` at the application level. For the Mini App, the backend SHALL issue a Supabase-compatible JWT with a `telegram_id` claim, and RLS policies written against that claim SHALL allow the Mini App to query Supabase directly (PostgREST/Realtime).

#### Scenario: Mini App direct query
- **WHEN** the Mini App queries Supabase with its JWT
- **THEN** RLS policies restrict results to rows belonging to the user's `telegram_id`

#### Scenario: Service-side query
- **WHEN** the backend fetches subscriptions for notification delivery
- **THEN** the query is scoped to the relevant connection/user ids

