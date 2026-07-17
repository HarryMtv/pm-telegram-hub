import { TokenBucket } from '../adapters/rate-limiter.js';

/**
 * Telegram Bot API limits (spec §6.1): ~30 msg/s globally, ~1 msg/s per private
 * chat, 20 msg/min per group. We enforce with a global bucket plus a per-chat
 * bucket keyed by chat id (negative id ⇒ group).
 */
const globalBucket = new TokenBucket(30, 30 / 1000); // 30 msg/s
const chatBuckets = new Map<number, TokenBucket>();

function chatBucket(chatId: number): TokenBucket {
  let bucket = chatBuckets.get(chatId);
  if (!bucket) {
    // Group chats (negative ids) are the tightest: 20 msg/min.
    bucket = chatId < 0 ? new TokenBucket(20, 20 / 60_000) : new TokenBucket(1, 1 / 1000);
    chatBuckets.set(chatId, bucket);
  }
  return bucket;
}

/** Acquire both the global and per-chat send slot (awaits if throttled). */
export async function acquireTelegramSlot(chatId: number): Promise<void> {
  await globalBucket.take();
  await chatBucket(chatId).take();
}
