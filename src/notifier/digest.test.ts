import { describe, expect, it, vi } from 'vitest';

import type { UnifiedEvent } from '../models/unified.js';

import { DigestBatcher } from './digest.js';

const event = (taskId: string): UnifiedEvent => ({
  provider: 'clickup',
  eventType: 'task.status_changed',
  dedupeKey: `d:${taskId}`,
  taskId,
  taskName: `Task ${taskId}`,
  details: { old: 'Open', new: 'Done' },
  raw: {},
});

describe('DigestBatcher', () => {
  it('collapses events for the same chat within the window into one flush', async () => {
    vi.useFakeTimers();
    const flush = vi.fn().mockResolvedValue(undefined);
    const batcher = new DigestBatcher(1000, flush);

    batcher.enqueue(-100, event('a'));
    batcher.enqueue(-100, event('b'));
    batcher.enqueue(-100, event('c'));

    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(flush).toHaveBeenCalledTimes(1);
    const [chatId, text] = flush.mock.calls[0]!;
    expect(chatId).toBe(-100);
    expect(text).toContain('Task a');
    expect(text).toContain('Task b');
    expect(text).toContain('Task c');
    vi.useRealTimers();
  });

  it('keeps separate chats in separate flushes', async () => {
    vi.useFakeTimers();
    const flush = vi.fn().mockResolvedValue(undefined);
    const batcher = new DigestBatcher(500, flush);
    batcher.enqueue(-1, event('a'));
    batcher.enqueue(-2, event('b'));
    await vi.advanceTimersByTimeAsync(500);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([-1, -2]));
    vi.useRealTimers();
  });

  it('flushAll drains immediately', async () => {
    vi.useFakeTimers();
    const flush = vi.fn().mockResolvedValue(undefined);
    const batcher = new DigestBatcher(10_000, flush);
    batcher.enqueue(-1, event('a'));
    await batcher.flushAll();
    expect(flush).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
