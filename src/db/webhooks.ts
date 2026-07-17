import { getSupabase, WebhookRow } from './client.js';

export interface NewWebhook {
  connectionId: string;
  provider: string;
  providerWebhookId: string;
  /** Already AES-256-GCM encrypted webhook secret. */
  secretEncrypted: string;
  scope?: Record<string, unknown>;
  expiresAt?: Date | null;
}

export async function createWebhook(input: NewWebhook): Promise<WebhookRow> {
  const { data, error } = await getSupabase()
    .from('webhooks')
    .insert({
      connection_id: input.connectionId,
      provider: input.provider,
      provider_webhook_id: input.providerWebhookId,
      secret: input.secretEncrypted,
      scope: input.scope ?? {},
      expires_at: input.expiresAt ? input.expiresAt.toISOString() : null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`createWebhook failed: ${error?.message ?? 'no row'}`);
  return data;
}

/** Lookup by provider-issued id to resolve the secret + owning connection. */
export async function findWebhookByProviderId(
  provider: string,
  providerWebhookId: string,
): Promise<WebhookRow | null> {
  const { data, error } = await getSupabase()
    .from('webhooks')
    .select()
    .eq('provider', provider)
    .eq('provider_webhook_id', providerWebhookId)
    .maybeSingle();
  if (error) throw new Error(`findWebhookByProviderId failed: ${error.message}`);
  return data;
}

export async function listWebhooksForConnection(connectionId: string): Promise<WebhookRow[]> {
  const { data, error } = await getSupabase()
    .from('webhooks')
    .select()
    .eq('connection_id', connectionId);
  if (error) throw new Error(`listWebhooksForConnection failed: ${error.message}`);
  return data ?? [];
}

export async function deleteWebhookByProviderId(
  provider: string,
  providerWebhookId: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from('webhooks')
    .delete()
    .eq('provider', provider)
    .eq('provider_webhook_id', providerWebhookId);
  if (error) throw new Error(`deleteWebhookByProviderId failed: ${error.message}`);
}
