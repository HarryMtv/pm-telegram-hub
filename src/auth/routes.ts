import type { FastifyInstance } from 'fastify';

import { upsertUserByTelegram } from '../db/users.js';
import { logger } from '../logger.js';
import { signTelegramJwt, validateInitData } from './init-data.js';

/** POST /api/auth/init-data — exchange Telegram initData for a short-lived JWT. */
export async function register(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/init-data', async (req, reply) => {
    const { initData } = (req.body as { initData?: string } | null) ?? {};
    if (!initData) return reply.code(400).send({ error: 'initData required' });

    const validated = validateInitData(initData);
    if (!validated) return reply.code(401).send({ error: 'invalid initData' });

    await upsertUserByTelegram({
      telegramId: validated.user.id,
      username: validated.user.username,
      firstName: validated.user.first_name,
      lastName: validated.user.last_name,
    });

    logger.debug({ telegramId: validated.user.id }, 'mini app authenticated');
    return reply.send({
      token: signTelegramJwt(validated.user.id),
      user: validated.user,
    });
  });
}
