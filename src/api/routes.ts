import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { registry } from '../adapters/index.js';
import { telegramIdFromAuth } from '../auth/jwt.js';
import { listConnectionsForUser } from '../db/connections.js';
import { upsertSubscription } from '../db/subscriptions.js';
import { getUserByTelegramId } from '../db/users.js';
import { logger } from '../logger.js';
import { connectProvider } from '../services/connection-service.js';

/** Resolve the authenticated user id from the Bearer JWT, or reply 401. */
async function requireUserId(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const telegramId = telegramIdFromAuth(req.headers.authorization);
  if (!telegramId) {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    reply.code(401).send({ error: 'no user' });
    return null;
  }
  return user.id;
}

/** Adapter metadata for rendering credential forms (spec §7.3/8.1). */
export async function register(app: FastifyInstance): Promise<void> {
  app.get('/api/adapters', async (req, reply) => {
    if (!(await requireUserId(req, reply))) return;
    return reply.send({
      adapters: registry.list().map((id) => {
        const adapter = registry.get(id);
        return {
          id: adapter.id,
          capabilities: adapter.capabilities(),
          credentialFields: adapter.credentialFields(),
        };
      }),
    });
  });

  app.get('/api/connections', async (req, reply) => {
    const userId = await requireUserId(req, reply);
    if (!userId) return;
    const connections = await listConnectionsForUser(userId);
    // Never expose credentials to the client.
    return reply.send({
      connections: connections.map((c) => ({
        id: c.id,
        provider: c.provider,
        scopeId: c.scope_id,
        isActive: c.is_active,
        createdAt: c.created_at,
      })),
    });
  });

  app.post('/api/connect', async (req, reply) => {
    const userId = await requireUserId(req, reply);
    if (!userId) return;
    const { provider, credentials } =
      (req.body as { provider?: string; credentials?: Record<string, string> }) ?? {};
    if (!provider || !credentials)
      return reply.code(400).send({ error: 'provider and credentials required' });
    try {
      const result = await connectProvider(userId, provider, credentials);
      return reply.send(result);
    } catch (err) {
      logger.warn({ err: (err as Error).message, provider }, 'mini app connect failed');
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/subscriptions', async (req, reply) => {
    const userId = await requireUserId(req, reply);
    if (!userId) return;
    const { connectionId, telegramChatId, eventTypes, filters } =
      (req.body as {
        connectionId?: string;
        telegramChatId?: number;
        eventTypes?: string[];
        filters?: Record<string, unknown>;
      }) ?? {};
    if (!connectionId || !telegramChatId) {
      return reply.code(400).send({ error: 'connectionId and telegramChatId required' });
    }
    const sub = await upsertSubscription({
      userId,
      connectionId,
      telegramChatId,
      eventTypes,
      filters,
    });
    return reply.send({ subscription: { id: sub.id, isActive: sub.is_active } });
  });
}
