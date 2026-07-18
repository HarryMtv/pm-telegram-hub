import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { registry } from '../adapters/index.js';
import type { StatusCategory } from '../adapters/types.js';
import { telegramIdFromAuth } from '../auth/jwt.js';
import type { ProviderConnectionRow, UserRow } from '../db/client.js';
import { getConnectionById, listConnectionsForUser } from '../db/connections.js';
import {
  deleteMappingForUser,
  listMappingsForUser,
  upsertMapping,
} from '../db/mappings.js';
import {
  deleteSubscriptionForUser,
  listSubscriptionsForUser,
  upsertSubscription,
} from '../db/subscriptions.js';
import { getUserByTelegramId } from '../db/users.js';
import { logger } from '../logger.js';
import { runWithConnection } from '../services/adapter-runner.js';
import { connectProvider, disconnectProvider } from '../services/connection-service.js';
import { mergeTaskFeed, type ConnectionTaskResult } from './task-feed.js';

/** Resolve the authenticated user from the Bearer JWT, or reply 401 and return null. */
async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<UserRow | null> {
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
  return user;
}

/** Load a connection and assert it belongs to `userId`, else reply 404 and return null. */
async function ownedConnection(
  userId: string,
  connectionId: string,
  reply: FastifyReply,
): Promise<ProviderConnectionRow | null> {
  const conn = await getConnectionById(connectionId);
  if (!conn || conn.user_id !== userId) {
    reply.code(404).send({ error: 'connection not found' });
    return null;
  }
  return conn;
}

/** Parse the shared task-query filters from a request query object. */
function taskQueryFromRequest(q: Record<string, unknown>): {
  containerId?: string;
  assigneeIsMe?: boolean;
  statusCategory?: StatusCategory;
  text?: string;
  limit?: number;
} {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const cat = str(q.statusCategory);
  const validCat: StatusCategory[] = ['open', 'in_progress', 'done', 'cancelled'];
  const limit = Number(q.limit);
  return {
    containerId: str(q.containerId),
    assigneeIsMe: q.assigneeIsMe === 'true' || q.assigneeIsMe === true,
    statusCategory: validCat.includes(cat as StatusCategory) ? (cat as StatusCategory) : undefined,
    text: str(q.text),
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
  };
}

export async function register(app: FastifyInstance): Promise<void> {
  // ── Adapters & connections ─────────────────────────────────────────────────

  /** Adapter metadata for rendering credential forms (spec §7.3/8.1). */
  app.get('/api/adapters', async (req, reply) => {
    if (!(await requireUser(req, reply))) return;
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
    const user = await requireUser(req, reply);
    if (!user) return;
    const connections = await listConnectionsForUser(user.id);
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
    const user = await requireUser(req, reply);
    if (!user) return;
    const { provider, credentials } =
      (req.body as { provider?: string; credentials?: Record<string, string> }) ?? {};
    if (!provider || !credentials)
      return reply.code(400).send({ error: 'provider and credentials required' });
    try {
      const result = await connectProvider(user.id, provider, credentials);
      return reply.send(result);
    } catch (err) {
      logger.warn({ err: (err as Error).message, provider }, 'mini app connect failed');
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete('/api/connections/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    try {
      await disconnectProvider(user.id, id);
      return reply.send({ ok: true });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'connection not found') return reply.code(404).send({ error: msg });
      logger.warn({ err: msg, connectionId: id }, 'disconnect failed');
      return reply.code(400).send({ error: msg });
    }
  });

  app.get('/api/connections/:id/containers', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const conn = await ownedConnection(user.id, id, reply);
    if (!conn) return;
    const { parentId } = req.query as { parentId?: string };
    const containers = await runWithConnection(conn, (adapter, creds) =>
      adapter.listContainers(creds, parentId),
    );
    return reply.send({ containers });
  });

  // ── Subscriptions ───────────────────────────────────────────────────────────

  app.get('/api/subscriptions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const subs = await listSubscriptionsForUser(user.id);
    return reply.send({
      subscriptions: subs.map((s) => ({
        id: s.id,
        connectionId: s.connection_id,
        eventTypes: s.event_types,
        filters: s.filters,
        isActive: s.is_active,
      })),
    });
  });

  app.post('/api/subscriptions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { connectionId, eventTypes, filters } =
      (req.body as {
        connectionId?: string;
        eventTypes?: string[];
        filters?: Record<string, unknown>;
      }) ?? {};
    if (!connectionId) return reply.code(400).send({ error: 'connectionId required' });
    const conn = await ownedConnection(user.id, connectionId, reply);
    if (!conn) return;
    // The subscription targets the user's own (personal) chat — resolved from the
    // authenticated identity, never supplied by the client (Telegram exposes no
    // group-chat list to the bot).
    const sub = await upsertSubscription({
      userId: user.id,
      connectionId,
      telegramChatId: Number(user.telegram_id),
      eventTypes,
      filters,
    });
    return reply.send({ subscription: { id: sub.id, isActive: sub.is_active } });
  });

  app.delete('/api/subscriptions/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    await deleteSubscriptionForUser(id, user.id);
    return reply.send({ ok: true });
  });

  // ── Tasks (unified inbox) ─────────────────────────────────────────────────────

  app.get('/api/tasks', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const query = taskQueryFromRequest(req.query as Record<string, unknown>);
    const { provider } = req.query as { provider?: string };
    const connections = (await listConnectionsForUser(user.id)).filter(
      (c) => c.is_active && (!provider || c.provider === provider),
    );
    const results: ConnectionTaskResult[] = await Promise.all(
      connections.map(async (conn) => {
        try {
          const tasks = await runWithConnection(conn, (adapter, creds) =>
            adapter.listTasks(creds, query),
          );
          return { connectionId: conn.id, tasks };
        } catch (err) {
          logger.warn(
            { err: (err as Error).message, connectionId: conn.id },
            'listTasks failed for connection',
          );
          return { connectionId: conn.id };
        }
      }),
    );
    return reply.send({ tasks: mergeTaskFeed(results, query.limit) });
  });

  app.post('/api/tasks', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { connectionId, name, containerId, description, assignees, dueDate, statusId } =
      (req.body as {
        connectionId?: string;
        name?: string;
        containerId?: string;
        description?: string;
        assignees?: string[];
        dueDate?: string;
        statusId?: string;
      }) ?? {};
    if (!connectionId || !name || !containerId)
      return reply.code(400).send({ error: 'connectionId, name and containerId required' });
    const conn = await ownedConnection(user.id, connectionId, reply);
    if (!conn) return;
    try {
      const task = await runWithConnection(conn, (adapter, creds) =>
        adapter.createTask(creds, { name, containerId, description, assignees, dueDate, statusId }),
      );
      return reply.send({ task });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/tasks/:connectionId/:taskId', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { connectionId, taskId } = req.params as { connectionId: string; taskId: string };
    const conn = await ownedConnection(user.id, connectionId, reply);
    if (!conn) return;
    const task = await runWithConnection(conn, (adapter, creds) => adapter.getTask(creds, taskId));
    return reply.send({ task });
  });

  app.get('/api/tasks/:connectionId/:taskId/statuses', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { connectionId, taskId } = req.params as { connectionId: string; taskId: string };
    const conn = await ownedConnection(user.id, connectionId, reply);
    if (!conn) return;
    const statuses = await runWithConnection(conn, (adapter, creds) =>
      adapter.getAvailableStatuses(creds, taskId),
    );
    return reply.send({ statuses });
  });

  app.post('/api/tasks/:connectionId/:taskId/status', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { connectionId, taskId } = req.params as { connectionId: string; taskId: string };
    const { statusId } = (req.body as { statusId?: string }) ?? {};
    if (!statusId) return reply.code(400).send({ error: 'statusId required' });
    const conn = await ownedConnection(user.id, connectionId, reply);
    if (!conn) return;
    try {
      await runWithConnection(conn, (adapter, creds) =>
        adapter.setStatus(creds, taskId, statusId),
      );
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/tasks/:connectionId/:taskId/comment', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { connectionId, taskId } = req.params as { connectionId: string; taskId: string };
    const { text } = (req.body as { text?: string }) ?? {};
    if (!text) return reply.code(400).send({ error: 'text required' });
    const conn = await ownedConnection(user.id, connectionId, reply);
    if (!conn) return;
    try {
      await runWithConnection(conn, (adapter, creds) => adapter.addComment(creds, taskId, text));
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // ── Mappings ──────────────────────────────────────────────────────────────────

  app.get('/api/mappings', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const mappings = await listMappingsForUser(user.id);
    return reply.send({
      mappings: mappings.map((m) => ({
        id: m.id,
        provider: m.provider,
        alias: m.alias,
        containerId: m.container_id,
        containerMeta: m.container_meta,
        isDefault: m.is_default,
      })),
    });
  });

  app.post('/api/mappings', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { provider, alias, containerId, containerMeta, isDefault } =
      (req.body as {
        provider?: string;
        alias?: string;
        containerId?: string;
        containerMeta?: Record<string, unknown>;
        isDefault?: boolean;
      }) ?? {};
    if (!provider || !alias || !containerId)
      return reply.code(400).send({ error: 'provider, alias and containerId required' });
    const mapping = await upsertMapping({
      userId: user.id,
      provider,
      alias,
      containerId,
      containerMeta,
      isDefault,
    });
    return reply.send({ mapping: { id: mapping.id, alias: mapping.alias } });
  });

  app.delete('/api/mappings/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    await deleteMappingForUser(id, user.id);
    return reply.send({ ok: true });
  });
}
