import { getSupabase, ProviderConnectionRow } from './client.js';

export interface NewConnection {
  userId: string;
  provider: string;
  scopeId: string;
  /** Already AES-256-GCM encrypted opaque credentials string. */
  credentialsEncrypted: string;
  /** Owner identity for self-echo suppression; null for legacy rows. */
  account?: { externalId?: string; displayName?: string | null } | null;
}

export async function createConnection(input: NewConnection): Promise<ProviderConnectionRow> {
  // Idempotent: one connection per (user, provider, workspace). Re-connecting
  // (e.g. after a failed webhook registration) refreshes credentials and reuses
  // the row instead of failing on unique(user_id, provider, scope_id).
  const { data, error } = await getSupabase()
    .from('provider_connections')
    .upsert(
      {
        user_id: input.userId,
        provider: input.provider,
        scope_id: input.scopeId,
        credentials: input.credentialsEncrypted,
        account: input.account ?? null,
        is_active: true,
      },
      { onConflict: 'user_id,provider,scope_id' },
    )
    .select()
    .single();

  if (error || !data) throw new Error(`createConnection failed: ${error?.message ?? 'no row'}`);
  return data;
}

export async function getConnectionById(id: string): Promise<ProviderConnectionRow | null> {
  const { data, error } = await getSupabase()
    .from('provider_connections')
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getConnectionById failed: ${error.message}`);
  return data;
}

/** Used by the worker — only active connections receive events. */
export async function getActiveConnectionById(id: string): Promise<ProviderConnectionRow | null> {
  const { data, error } = await getSupabase()
    .from('provider_connections')
    .select()
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new Error(`getActiveConnectionById failed: ${error.message}`);
  return data;
}

/** Scoped by user_id — isolation enforced at the application level. */
export async function listConnectionsForUser(userId: string): Promise<ProviderConnectionRow[]> {
  const { data, error } = await getSupabase()
    .from('provider_connections')
    .select()
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listConnectionsForUser failed: ${error.message}`);
  return data ?? [];
}

export async function setConnectionActive(id: string, active: boolean): Promise<void> {
  const { error } = await getSupabase()
    .from('provider_connections')
    .update({ is_active: active })
    .eq('id', id);
  if (error) throw new Error(`setConnectionActive failed: ${error.message}`);
}

/** Hard-delete a connection (its webhooks/subscriptions cascade at the DB level). */
export async function deleteConnection(id: string): Promise<void> {
  const { error } = await getSupabase().from('provider_connections').delete().eq('id', id);
  if (error) throw new Error(`deleteConnection failed: ${error.message}`);
}
