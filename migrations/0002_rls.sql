-- 0002_rls.sql — Row Level Security for the Mini App.
-- Spec: §3.1.
--
-- Users authenticate via Telegram, not Supabase Auth, so `auth.uid()` is
-- useless here. Instead the backend issues a short-lived Supabase-compatible
-- JWT carrying a `telegram_id` claim; RLS policies are written against that
-- claim. The backend service uses the service key and bypasses RLS entirely.

-- Helper: the telegram_id of the current request's JWT (NULL if absent).
create or replace function public.current_telegram_id()
returns bigint
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'telegram_id', '')::bigint
$$;

-- ── Enable RLS everywhere ────────────────────────────────────────────────────
-- Tables without a policy below default-deny for the Mini App's JWT role, while
-- the backend's service role bypasses RLS. webhooks (secrets) and
-- notification_log are intentionally Mini-App-opaque.
alter table users                enable row level security;
alter table provider_connections enable row level security;
alter table subscriptions        enable row level security;
alter table mappings             enable row level security;
alter table webhooks             enable row level security;
alter table notification_log     enable row level security;

-- ── users: a row is visible iff its telegram_id matches the JWT ───────────────
drop policy if exists users_own on users;
create policy users_own on users
  for all
  using (telegram_id = public.current_telegram_id())
  with check (telegram_id = public.current_telegram_id());

-- ── rows that carry user_id: visible iff the owning user's telegram_id matches
drop policy if exists connections_own on provider_connections;
create policy connections_own on provider_connections
  for all
  using (
    exists (
      select 1 from users u
      where u.id = provider_connections.user_id
        and u.telegram_id = public.current_telegram_id()
    )
  )
  with check (
    exists (
      select 1 from users u
      where u.id = provider_connections.user_id
        and u.telegram_id = public.current_telegram_id()
    )
  );

drop policy if exists subscriptions_own on subscriptions;
create policy subscriptions_own on subscriptions
  for all
  using (
    exists (
      select 1 from users u
      where u.id = subscriptions.user_id
        and u.telegram_id = public.current_telegram_id()
    )
  )
  with check (
    exists (
      select 1 from users u
      where u.id = subscriptions.user_id
        and u.telegram_id = public.current_telegram_id()
    )
  );

drop policy if exists mappings_own on mappings;
create policy mappings_own on mappings
  for all
  using (
    exists (
      select 1 from users u
      where u.id = mappings.user_id
        and u.telegram_id = public.current_telegram_id()
    )
  )
  with check (
    exists (
      select 1 from users u
      where u.id = mappings.user_id
        and u.telegram_id = public.current_telegram_id()
    )
  );
