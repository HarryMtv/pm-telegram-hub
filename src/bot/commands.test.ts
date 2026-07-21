import { Bot, type Transformer } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAdapters } from '../adapters/index.js';
import { connectProvider } from '../services/connection-service.js';
import { registerCommands } from './commands.js';

// The connect flow must never touch the network or DB in this test — we only
// care that the token-bearing message is deleted from chat.
vi.mock('../services/connection-service.js', () => ({
  connectProvider: vi.fn(),
}));
vi.mock('../db/users.js', () => ({
  upsertUserByTelegram: vi.fn(async () => ({ id: 'u1' })),
}));

registerAdapters(); // makes `clickup` (single-token) resolvable in the registry

const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: 'Test',
  username: 'test_bot',
} as unknown as UserFromGetMe;

const TOKEN_MESSAGE_ID = 555;

/** Build a `/connect clickup <token>` update as it arrives from Telegram. */
function connectUpdate(): Update {
  return {
    update_id: 1,
    message: {
      message_id: TOKEN_MESSAGE_ID,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 42, type: 'private', first_name: 'T' },
      from: { id: 42, is_bot: false, first_name: 'T' },
      text: '/connect clickup pk_supersecret',
      entities: [{ type: 'bot_command', offset: 0, length: 8 }],
    },
  } as unknown as Update;
}

/** A bot whose outgoing API calls are captured instead of sent. */
function makeBot(): { bot: Bot; calls: { method: string; payload: Record<string, unknown> }[] } {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const capture = (async (_prev: unknown, method: unknown, payload: unknown) => {
    calls.push({ method: method as string, payload: payload as Record<string, unknown> });
    return { ok: true, result: true };
  }) as unknown as Transformer;

  const bot = new Bot('12345:TEST', { botInfo: BOT_INFO });
  bot.api.config.use(capture);
  registerCommands(bot);
  return { bot, calls };
}

describe('/connect', () => {
  beforeEach(() => {
    vi.mocked(connectProvider).mockReset();
  });

  it('deletes the token message even when connecting fails', async () => {
    vi.mocked(connectProvider).mockRejectedValueOnce(new Error('invalid token'));
    const { bot, calls } = makeBot();

    await bot.handleUpdate(connectUpdate());

    const del = calls.find((c) => c.method === 'deleteMessage');
    expect(del).toBeDefined();
    expect(del?.payload.message_id).toBe(TOKEN_MESSAGE_ID);
    // The user still gets an error reply, but the token is already gone.
    expect(calls.some((c) => c.method === 'sendMessage')).toBe(true);
  });

  it('deletes the token message on a successful connect', async () => {
    vi.mocked(connectProvider).mockResolvedValueOnce({ webhookRegistered: true } as never);
    const { bot, calls } = makeBot();

    await bot.handleUpdate(connectUpdate());

    expect(calls.some((c) => c.method === 'deleteMessage')).toBe(true);
  });
});
