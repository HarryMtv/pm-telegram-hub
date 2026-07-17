import type { FastifyInstance } from 'fastify';

import { config } from '../config/index.js';
import { logger } from '../logger.js';
import { registerCommands } from './commands.js';
import { getBot } from './instance.js';

let started = false;

function telegramWebhookUrl(): string {
  return `${config.appUrl.replace(/\/+$/, '')}/api/telegram`;
}

export function setupBot(): void {
  const bot = getBot();
  registerCommands(bot);
  bot.catch(({ error }) => logger.error({ err: (error as Error).message }, 'bot handler error'));
}

export async function startBot(): Promise<void> {
  if (started) return;
  setupBot();
  const bot = getBot();

  if (config.telegram.botMode === 'webhook') {
    await bot.init();
    await bot.api.setWebhook(telegramWebhookUrl(), {
      secret_token: config.telegram.webhookSecret,
    });
    logger.info({ url: telegramWebhookUrl() }, 'bot started (webhook mode)');
  } else {
    void bot
      .start({
        allowed_updates: ['message', 'callback_query'],
        onStart: () => logger.info('bot started (polling mode)'),
      })
      .catch((err) => logger.error({ err: (err as Error).message }, 'bot polling failed'));
  }
  started = true;
}

export async function stopBot(): Promise<void> {
  if (!started) return;
  await getBot().stop();
  started = false;
}

/**
 * Fastify route receiving Telegram updates in webhook mode. Verifies the
 * `secret_token` header on every update (spec §6.3).
 */
export async function register(app: FastifyInstance): Promise<void> {
  app.post('/api/telegram', async (req, reply) => {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    const secret = Array.isArray(header) ? header[0] : header;
    if (secret !== config.telegram.webhookSecret) {
      return reply.code(401).send({ error: 'bad telegram secret' });
    }
    await getBot().handleUpdate(req.body as never);
    return reply.code(200).send({ ok: true });
  });
}
