import { Api, Bot } from 'grammy';

import { config } from '../config/index.js';

let _bot: Bot | null = null;

/** The singleton grammY bot. Handlers are registered in `src/bot/index.ts`. */
export function getBot(): Bot {
  if (!_bot) _bot = new Bot(config.telegram.botToken);
  return _bot;
}

/** Raw Telegram API for sending messages outside update handling (notifier). */
export function getBotApi(): Api {
  return getBot().api;
}
