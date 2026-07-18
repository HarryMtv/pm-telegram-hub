import { randomBytes } from 'node:crypto';

import { withConnection } from '../adapters/context.js';
import { registry } from '../adapters/index.js';
import { rateLimiters } from '../adapters/rate-limiter.js';
import type { ProviderCredentials } from '../adapters/types.js';
import { config } from '../config/index.js';
import { encrypt, encryptJson } from '../crypto/index.js';
import {
  createConnection,
  deleteConnection,
  getConnectionById,
} from '../db/connections.js';
import {
  createWebhook,
  deleteWebhookByProviderId,
  listWebhooksForConnection,
} from '../db/webhooks.js';
import { logger } from '../logger.js';
import { runWithConnection } from './adapter-runner.js';

export interface ConnectResult {
  connectionId: string;
  scopeId: string;
  webhookRegistered: boolean;
  /** Present for admin-required providers (Jira): the URL + secret the admin must
   * register in the provider's webhook console (spec §7.3 onboarding). */
  onboarding?: { webhookUrl: string; secret: string };
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
  let onboarding: ConnectResult['onboarding'];
  if (adapter.capabilities().webhookSetup === 'auto') {
    const limiter = rateLimiters.forConnection(
      connection.id,
      adapter.rateLimit(connectionCore(connection.id, provider, account.scopeId, credentials)),
    );
    const ref = await withConnection(
      {
        connection: connectionCore(connection.id, provider, account.scopeId, credentials),
        limiter,
      },
      () =>
        adapter.registerWebhook(credentials, { level: 'workspace', workspaceId: account.scopeId }),
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
  } else {
    // admin-required (Jira): the admin registers the webhook in the provider's UI.
    // Generate the signing secret now and persist it so incoming deliveries verify;
    // surface URL + secret for the Mini App onboarding screen. The provider-issued
    // webhook id is reconciled on first delivery (Phase 3), so key the row by the
    // connection id for now.
    const secret = randomBytes(32).toString('hex');
    await createWebhook({
      connectionId: connection.id,
      provider,
      providerWebhookId: connection.id,
      secretEncrypted: encrypt(secret),
    });
    onboarding = { webhookUrl: config.webhookUrlFor(provider), secret };
  }

  logger.info({ userId, provider, connectionId: connection.id }, 'provider connected');
  return { connectionId: connection.id, scopeId: account.scopeId, webhookRegistered, onboarding };
}

/**
 * Disconnect a provider: verify the connection belongs to `userId`, best-effort
 * deregister its provider webhooks, then delete the connection (webhook and
 * subscription rows cascade at the DB level).
 */
export async function disconnectProvider(userId: string, connectionId: string): Promise<void> {
  const connection = await getConnectionById(connectionId);
  if (!connection || connection.user_id !== userId) {
    throw new Error('connection not found');
  }
  const webhooks = await listWebhooksForConnection(connectionId);
  for (const wh of webhooks) {
    try {
      await runWithConnection(connection, (adapter, creds) =>
        adapter.deleteWebhook(creds, wh.provider_webhook_id),
      );
    } catch (err) {
      // Best-effort: a provider-side failure must not block local cleanup.
      logger.warn(
        { err: (err as Error).message, connectionId, provider: connection.provider },
        'deleteWebhook during disconnect failed',
      );
    }
    await deleteWebhookByProviderId(wh.provider, wh.provider_webhook_id);
  }
  await deleteConnection(connectionId);
  logger.info({ userId, connectionId, provider: connection.provider }, 'provider disconnected');
}

function connectionCore(
  id: string,
  provider: string,
  scopeId: string,
  credentials: ProviderCredentials,
) {
  return { id, provider, scopeId, credentials };
}
