import { registry } from '../adapters/index.js';
import { withConnection } from '../adapters/context.js';
import { rateLimiters } from '../adapters/rate-limiter.js';
import type { ProviderCredentials } from '../adapters/types.js';
import { encrypt, encryptJson } from '../crypto/index.js';
import { createConnection } from '../db/connections.js';
import { createWebhook } from '../db/webhooks.js';
import { logger } from '../logger.js';

export interface ConnectResult {
  connectionId: string;
  scopeId: string;
  webhookRegistered: boolean;
}

/**
 * Verify credentials, persist the connection (encrypted), and — for auto-setup
 * providers — register the webhook and store its (encrypted) secret. The secret
 * source is encapsulated in the adapter (ClickUp: provider-issued; Wrike: ours).
 */
export async function connectProvider(
  userId: string,
  provider: string,
  credentials: ProviderCredentials,
): Promise<ConnectResult> {
  const adapter = registry.get(provider);
  const account = await adapter.verifyCredentials(credentials);

  const connection = await createConnection({
    userId,
    provider,
    scopeId: account.scopeId,
    credentialsEncrypted: encryptJson(credentials),
    account: { externalId: account.externalId, displayName: account.displayName ?? null },
  });

  let webhookRegistered = false;
  if (adapter.capabilities().webhookSetup === 'auto') {
    const limiter = rateLimiters.forConnection(connection.id, adapter.rateLimit(connectionCore(connection.id, provider, account.scopeId, credentials)));
    const ref = await withConnection(
      { connection: connectionCore(connection.id, provider, account.scopeId, credentials), limiter },
      () => adapter.registerWebhook(credentials, { level: 'workspace', workspaceId: account.scopeId }),
    );
    await createWebhook({
      connectionId: connection.id,
      provider,
      providerWebhookId: ref.providerWebhookId,
      secretEncrypted: encrypt(ref.secret),
      scope: ref.scope,
      expiresAt: ref.expiresAt ?? null,
    });
    webhookRegistered = true;
  }

  logger.info({ userId, provider, connectionId: connection.id }, 'provider connected');
  return { connectionId: connection.id, scopeId: account.scopeId, webhookRegistered };
}

function connectionCore(
  id: string,
  provider: string,
  scopeId: string,
  credentials: ProviderCredentials,
) {
  return { id, provider, scopeId, credentials };
}
