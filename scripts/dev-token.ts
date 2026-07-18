/**
 * Mint a dev JWT for debugging the Mini App in a browser (no Telegram).
 *
 *   pnpm tsx scripts/dev-token.ts <telegram_id> [ttl_days]
 *
 * Paste the printed token into devtools on http://localhost:5173:
 *   localStorage.setItem('token', '<token>')
 * The user with this telegram_id must already exist in the DB
 * (interact with the bot once first).
 */
import 'dotenv/config';

import { signTelegramJwt } from '../src/auth/init-data.js';

const telegramId = Number(process.argv[2]);
const ttlDays = Number(process.argv[3] ?? 30);

if (!Number.isInteger(telegramId) || telegramId <= 0) {
  console.error('usage: pnpm tsx scripts/dev-token.ts <telegram_id> [ttl_days]');
  process.exit(1);
}

console.log(signTelegramJwt(telegramId, ttlDays * 24 * 60 * 60));
