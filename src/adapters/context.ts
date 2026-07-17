import { AsyncLocalStorage } from 'node:async_hooks';

import type { TokenBucket } from './rate-limiter.js';
import type { Connection } from './types.js';

/**
 * Per-job / per-command connection context. Because the adapter contract passes
 * only `creds` (spec §2.1) and the rate limit is per-connection, the worker and
 * bot set this context around adapter calls; the shared HTTP client reads the
 * limiter from here so adapter method signatures stay clean.
 */
export interface AdapterContext {
  connection: Connection;
  limiter: TokenBucket;
}

export const adapterContext = new AsyncLocalStorage<AdapterContext>();

export function currentConnection(): Connection | undefined {
  return adapterContext.getStore()?.connection;
}

export function currentLimiter(): TokenBucket | undefined {
  return adapterContext.getStore()?.limiter;
}

/** Run `fn` with a connection/limiter context active. */
export function withConnection<T>(ctx: AdapterContext, fn: () => Promise<T>): Promise<T> {
  return adapterContext.run(ctx, fn);
}
