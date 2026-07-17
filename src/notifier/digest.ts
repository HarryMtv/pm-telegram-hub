import type { UnifiedEvent } from '../models/unified.js';

import { renderEvent } from './templates.js';

interface Pending {
  events: UnifiedEvent[];
  timer?: NodeJS.Timeout;
}

export type DigestFlush = (chatId: number, text: string) => Promise<void>;

const SEPARATOR = '\n—————————————\n';

/**
 * Digest batching for group bursts (spec §6.1 / 8.5). Events for the same chat
 * within `windowMs` collapse into a single message. Production wires this for
 * group chats (negative ids) where the 20 msg/min limit bites hardest.
 */
export class DigestBatcher {
  private buffers = new Map<number, Pending>();

  constructor(
    private readonly windowMs: number,
    private readonly flush: DigestFlush,
  ) {}

  enqueue(chatId: number, event: UnifiedEvent): void {
    const pending = this.buffers.get(chatId) ?? { events: [] };
    pending.events.push(event);
    if (!pending.timer) {
      pending.timer = setTimeout(() => void this.flushNow(chatId), this.windowMs);
    }
    this.buffers.set(chatId, pending);
  }

  private async flushNow(chatId: number): Promise<void> {
    const pending = this.buffers.get(chatId);
    if (!pending) return;
    this.buffers.delete(chatId);
    await this.flush(chatId, pending.events.slice(0, 50).map(renderEvent).join(SEPARATOR));
  }

  /** Flush everything pending immediately (tests / graceful shutdown). */
  async flushAll(): Promise<void> {
    for (const chatId of [...this.buffers.keys()]) await this.flushNow(chatId);
  }
}
