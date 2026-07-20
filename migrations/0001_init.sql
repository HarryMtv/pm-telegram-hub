-- 0001_init.sql — Telegram Aggregator core schema (provider-agnostic).
-- Spec: §3.
--
-- Iron rule: NO provider-specific columns. Provider-dependent data lives in the
-- `provider` text column and `jsonb` fields only.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ── updated_at maintenance ───────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── users (identity = Telegram, not Supabase Auth) ───────────────────────────
create table if not exists users (
  id                 uuid primary key default gen_random_uuid(),
  telegram_id        bigint not null unique,
  telegram_username  text,
  first_name         text,
  last_name          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- ── provider_connections ─────────────────────────────────────────────────────
-- credentials: opaque JSON (shape known only to the adapter), AES-256-GCM
-- encrypted on the application side, stored as `iv:tag:ciphertext` (base64).
create table if not exists provider_connections (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  provider     text not null,                 -- 'clickup' | 'wrike' | 'jira' | ...
  credentials  text not null,                 -- encrypted opaque JSON
  scope_id     text not null,                 -- ClickUp: team_id; Wrike: account_id; Jira: site url
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, provider, scope_id)
);

drop trigger if exists trg_provider_connections_updated_at on provider_connections;
create trigger trg_provider_connections_updated_at
  before update on provider_connections
  for each row execute function set_updated_at();

create index if not exists idx_connections_user
  on provider_connections (user_id);

-- ── webhooks (registered at providers; secret per-webhook) ────────────────────
-- secret: AES-256-GCM at rest. ClickUp issues the secret on creation; for
-- Wrike/Jira we generate it. For the core the difference is encapsulated in
-- the adapter's registerWebhook.
create table if not exists webhooks (
  id                   uuid primary key default gen_random_uuid(),
  connection_id        uuid not null references provider_connections(id) on delete cascade,
  provider             text not null,
  provider_webhook_id  text not null,
  secret               text not null,        -- encrypted
  scope                jsonb not null default '{}',
  expires_at           timestamptz,          -- for providers with webhook TTL (e.g. Jira OAuth: 30d)
  created_at           timestamptz not null default now(),
  unique (provider, provider_webhook_id)
);

create index if not exists idx_webhooks_lookup
  on webhooks (provider, provider_webhook_id);

-- ── mappings (container aliases for /newtask) ────────────────────────────────
create table if not exists mappings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  provider       text not null,
  alias          text not null,              -- "dev", "Dev Tasks"
  container_id   text not null,              -- ClickUp: list_id; Wrike: folder_id
  container_meta jsonb not null default '{}',
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (user_id, provider, alias)
);

create index if not exists idx_mappings_user
  on mappings (user_id);

-- ── subscriptions (chat × events × container filters) ────────────────────────
create table if not exists subscriptions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  connection_id     uuid not null references provider_connections(id) on delete cascade,
  telegram_chat_id  bigint not null,
  filters           jsonb not null default '{}',
  event_types       text[] not null default '{task.created,task.updated,task.assigned,task.status_changed,task.due_changed,comment.added}',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  -- idempotent /subscribe: a chat cannot subscribe twice to the same connection.
  unique (connection_id, telegram_chat_id)
);

-- Active subscriptions for a connection, used by the worker to fan out events.
create index if not exists idx_subscriptions_connection_active
  on subscriptions (connection_id) where is_active;

-- ── notification_log (delivery log + idempotency) ────────────────────────────
-- The unique constraint is the idempotency guarantee: a redelivered webhook with
-- the same dedupe_key for a subscription is skipped at the DB level.
create table if not exists notification_log (
  id                   uuid primary key default gen_random_uuid(),
  subscription_id      uuid not null references subscriptions(id) on delete cascade,
  dedupe_key           text not null,
  event_type           text not null,
  delivered_at         timestamptz not null default now(),
  telegram_message_id  bigint,
  unique (subscription_id, dedupe_key)
);

create index if not exists idx_notification_log_sub
  on notification_log (subscription_id);
