import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { telegramIdFromAuth } from '../auth/jwt.js';
import { getConnectionById } from '../db/connections.js';
import { upsertSubscription } from '../db/subscriptions.js';
import { getUserByTelegramId } from '../db/users.js';
import { disconnectProvider } from '../services/connection-service.js';
import { register } from './routes.js';

// Mock every collaborator the exercised routes touch. The point is the route
// glue: auth guard, ownership checks, and personal-chat resolution.
vi.mock('../auth/jwt.js', () => ({ telegramIdFromAuth: vi.fn() }));
vi.mock('../db/users.js', () => ({ getUserByTelegramId: vi.fn() }));
vi.mock('../db/connections.js', () => ({
  getConnectionById: vi.fn(),
  listConnectionsForUser: vi.fn(),
}));
vi.mock('../db/subscriptions.js', () => ({
  upsertSubscription: vi.fn(),
  listSubscriptionsForUser: vi.fn(),
  deleteSubscriptionForUser: vi.fn(),
}));
vi.mock('../services/connection-service.js', () => ({
  connectProvider: vi.fn(),
  disconnectProvider: vi.fn(),
}));

const auth = { authorization: 'Bearer t' };

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await register(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('api routes auth guard', () => {
  it('rejects requests without a valid token (401)', async () => {
    vi.mocked(telegramIdFromAuth).mockReturnValue(null);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/connections' });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /api/connections/:id ownership', () => {
  it('returns 404 when the connection is not the user’s', async () => {
    vi.mocked(telegramIdFromAuth).mockReturnValue(555);
    vi.mocked(getUserByTelegramId).mockResolvedValue({ id: 'u1', telegram_id: '555' } as never);
    vi.mocked(disconnectProvider).mockRejectedValue(new Error('connection not found'));
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/connections/c9', headers: auth });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/subscriptions personal-chat resolution', () => {
  it('targets the user’s own telegram id, ignoring any client-supplied chat', async () => {
    vi.mocked(telegramIdFromAuth).mockReturnValue(555);
    vi.mocked(getUserByTelegramId).mockResolvedValue({ id: 'u1', telegram_id: '555' } as never);
    vi.mocked(getConnectionById).mockResolvedValue({ id: 'c1', user_id: 'u1' } as never);
    vi.mocked(upsertSubscription).mockResolvedValue({ id: 's1', is_active: true } as never);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: auth,
      payload: { connectionId: 'c1', telegramChatId: 999999 }, // client value must be ignored
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(upsertSubscription)).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', connectionId: 'c1', telegramChatId: 555 }),
    );
  });

  it('rejects subscribing to a connection the user does not own (404)', async () => {
    vi.mocked(telegramIdFromAuth).mockReturnValue(555);
    vi.mocked(getUserByTelegramId).mockResolvedValue({ id: 'u1', telegram_id: '555' } as never);
    vi.mocked(getConnectionById).mockResolvedValue({ id: 'c1', user_id: 'other' } as never);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: auth,
      payload: { connectionId: 'c1' },
    });

    expect(res.statusCode).toBe(404);
    expect(vi.mocked(upsertSubscription)).not.toHaveBeenCalled();
  });
});
