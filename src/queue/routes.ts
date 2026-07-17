import type { FastifyInstance } from 'fastify';

import { registry } from '../adapters/index.js';
import { decrypt } from '../crypto/index.js';
import { findWebhookByProviderId } from '../db/webhooks.js';
import { logger } from '../logger.js';
import { inc } from '../metrics.js';
import { getQueue, type WebhookJobData } from './index.js';

function flattenHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      if (value[0] !== undefined) out[key] = value[0];
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Register the single, parameterized webhook endpoint (spec §5).
 * Fast-ACK contract: verify signature, enqueue, respond 200 — before any provider
 * API call or DB-heavy work, so providers don't deactivate us on slow responses.
 */
export async function register(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/:provider', async (req, reply) => {
    const { provider } = req.params as { provider: string };

    let adapter;
    try {
      adapter = registry.get(provider);
    } catch {
      return reply.code(404).send({ error: 'unknown provider' });
    }

    const headers = req.headers;
    const rawBody = req.rawBody ?? Buffer.from('');

    // 1. Handshake short-circuit (Wrike registration) — respond and exit, no job.
    if (adapter.handleHandshake) {
      const handshake = adapter.handleHandshake(headers, rawBody);
      if (handshake) {
        const response = reply.code(handshake.status ?? 200);
        for (const [key, value] of Object.entries(handshake.headers ?? {}))
          response.header(key, value);
        return response.send(handshake.body ?? '');
      }
    }

    // 2. Resolve the signing secret by webhook id (id is not secret; signature proves authenticity).
    const webhookId = adapter.extractWebhookId(req.body, headers);
    if (!webhookId) return reply.code(401).send({ error: 'no webhook id' });

    const webhook = await findWebhookByProviderId(provider, webhookId);
    if (!webhook) return reply.code(401).send({ error: 'unknown webhook' });

    // 3. Verify the signature over the raw bytes.
    const secret = decrypt(webhook.secret);
    if (!adapter.verifyWebhook(rawBody, headers, secret)) {
      logger.warn({ provider, webhookId }, 'webhook signature verification failed');
      return reply.code(401).send({ error: 'invalid signature' });
    }

    // 4. Enqueue the raw payload and ACK immediately.
    const jobData: WebhookJobData = {
      provider,
      connectionId: webhook.connection_id,
      payload: req.body,
      headers: flattenHeaders(headers),
    };
    await getQueue().add('webhook', jobData);
    inc('webhook_received', { provider });
    return reply.code(200).send({ ok: true });
  });
}
