import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { config } from '../config/index.js';

/**
 * Backend Supabase client using the service role key. This key bypasses RLS, so
 * every query from this client MUST be scoped by `user_id`/`connection_id` at
 * the application level (see the repository helpers). The Mini App never uses
 * this client — it uses its own short-lived JWT under RLS.
 */
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// ── Row types ────────────────────────────────────────────────────────────────
// Note: PostgREST returns PostgreSQL `bigint` columns as strings (JSON has no
// 64-bit int). `telegram_id` and `telegram_chat_id` are therefore `string` on
// reads; repositories accept `number` on writes (PostgREST coerces).

export interface UserRow {
  id: string;
  telegram_id: string;
  telegram_username: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderConnectionRow {
  id: string;
  user_id: string;
  provider: string;
  /** Encrypted opaque JSON (`iv:tag:ciphertext` base64). Shape is adapter-owned. */
  credentials: string;
  scope_id: string;
  /** Owner's provider identity for self-echo suppression. Null on legacy rows. */
  account: { externalId?: string; displayName?: string | null } | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebhookRow {
  id: string;
  connection_id: string;
  provider: string;
  provider_webhook_id: string;
  /** Encrypted (`iv:tag:ciphertext` base64). */
  secret: string;
  scope: Record<string, unknown>;
  expires_at: string | null;
  created_at: string;
}

export interface MappingRow {
  id: string;
  user_id: string;
  provider: string;
  alias: string;
  container_id: string;
  container_meta: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  connection_id: string;
  telegram_chat_id: string;
  filters: Record<string, unknown>;
  event_types: string[];
  is_active: boolean;
  created_at: string;
}

export interface NotificationLogRow {
  id: string;
  subscription_id: string;
  dedupe_key: string;
  event_type: string;
  delivered_at: string;
  telegram_message_id: string | null;
}
