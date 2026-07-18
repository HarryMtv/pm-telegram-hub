import { withConnection } from '../adapters/context.js';
import { registry } from '../adapters/index.js';
import type { ProviderAdapter } from '../adapters/provider-adapter.js';
import { rateLimiters } from '../adapters/rate-limiter.js';
import type { ProviderCredentials } from '../adapters/types.js';
import { decryptJson } from '../crypto/index.js';
import type { ProviderConnectionRow } from '../db/client.js';

/**
 * Run an adapter call inside the connection's rate-limit context: resolve the
 * adapter, decrypt credentials, build the per-connection limiter, and execute
 * `fn` within `withConnection` so provider HTTP goes through the limiter and
 * `currentConnection()` resolves. Shared by the bot and the Mini App API routes
 * so the rate-limit path never diverges.
 */
export async function runWithConnection<R>(
  conn: ProviderConnectionRow,
  fn: (adapter: ProviderAdapter, creds: ProviderCredentials) => Promise<R>,
): Promise<R> {
  const adapter = registry.get(conn.provider);
  const creds = decryptJson<ProviderCredentials>(conn.credentials);
  const connection = {
    id: conn.id,
    provider: conn.provider,
    scopeId: conn.scope_id,
    credentials: creds,
  };
  const limiter = rateLimiters.forConnection(conn.id, adapter.rateLimit(connection));
  return withConnection({ connection, limiter }, () => fn(adapter, creds));
}
