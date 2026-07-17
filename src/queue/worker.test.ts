import { describe, expect, it, vi } from 'vitest';

import type { UnifiedEvent } from '../models/unified.js';
import { fanOut, matchesFilters } from './worker.js';

const event: UnifiedEvent = {
  provider: 'clickup',
  eventType: 'task.status_changed',
  dedupeKey: 'dk1',
  taskId: 't1',
  taskName: 'Task',
  containerId: 'list-A',
  details: { old: 'Open', new: 'Done' },
  raw: {},
};

type Sub = {
  id: string;
  connection_id: string;
  telegram_chat_id: string;
  event_types: string[];
  filters: Record<string, unknown>;
};
const sub = (overrides: Partial<Sub> = {}): Sub => ({
  id: 's1',
  connection_id: 'c1',
  telegram_chat_id: '999',
  event_types: ['task.status_changed'],
  filters: {},
  ...overrides,
});

describe('worker fan-out', () => {
  it('delivers to a matching subscription and records the message id', async () => {
    const deliver = vi.fn().mockResolvedValue(42);
    const record = vi.fn().mockResolvedValue(undefined);
    const tryInsert = vi.fn().mockResolvedValue(true);

    await fanOut(event, [sub()], { tryInsert, deliver, record });

    expect(deliver).toHaveBeenCalledWith(999, event, { showActions: true, connectionId: 'c1' });
    expect(record).toHaveBeenCalledWith('s1', 'dk1', 42);
  });

  it('skips when the event type is not subscribed', async () => {
    const deliver = vi.fn();
    await fanOut(event, [sub({ event_types: ['task.created'] })], {
      tryInsert: vi.fn().mockResolvedValue(true),
      deliver,
      record: vi.fn(),
    });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('skips on container-filter mismatch', async () => {
    const deliver = vi.fn();
    await fanOut(event, [sub({ filters: { containers: ['list-B'] } })], {
      tryInsert: vi.fn().mockResolvedValue(true),
      deliver,
      record: vi.fn(),
    });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('skips a duplicate (tryInsert false) — idempotent delivery', async () => {
    const deliver = vi.fn();
    await fanOut(event, [sub()], {
      tryInsert: vi.fn().mockResolvedValue(false),
      deliver,
      record: vi.fn(),
    });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('suppresses self-echo when the event actor is the connection owner', async () => {
    const deliver = vi.fn();
    const tryInsert = vi.fn().mockResolvedValue(true);
    await fanOut(
      { ...event, actorId: 'u42' },
      [sub()],
      { tryInsert, deliver, record: vi.fn() },
      { selfActorId: 'u42' },
    );
    expect(deliver).not.toHaveBeenCalled();
    expect(tryInsert).not.toHaveBeenCalled();
  });

  it('delivers when the event actor is someone other than the owner', async () => {
    const deliver = vi.fn().mockResolvedValue(7);
    await fanOut(
      { ...event, actorId: 'u9' },
      [sub()],
      { tryInsert: vi.fn().mockResolvedValue(true), deliver, record: vi.fn() },
      { selfActorId: 'u42' },
    );
    expect(deliver).toHaveBeenCalled();
  });

  it('delivers comment events with a keyboard (variant chosen downstream)', async () => {
    const deliver = vi.fn().mockResolvedValue(5);
    await fanOut(
      { ...event, eventType: 'comment.added' },
      [sub({ event_types: ['comment.added'] })],
      { tryInsert: vi.fn().mockResolvedValue(true), deliver, record: vi.fn() },
    );
    expect(deliver).toHaveBeenCalledWith(
      999,
      expect.objectContaining({ eventType: 'comment.added' }),
      expect.objectContaining({ showActions: true }),
    );
  });
});

describe('matchesFilters', () => {
  it('passes when no container filter is set', () => {
    expect(matchesFilters({}, event)).toBe(true);
  });
  it('passes when the task container is in the filter list', () => {
    expect(matchesFilters({ containers: ['list-A'] }, event)).toBe(true);
  });
  it('fails when the task container is not in the filter list', () => {
    expect(matchesFilters({ containers: ['list-A'] }, { ...event, containerId: 'list-B' })).toBe(
      false,
    );
  });
  it('passes the assignee filter when the owner is an assignee', () => {
    const e = { ...event, details: { assigneeIds: ['u9', 'u42'] } };
    expect(matchesFilters({ assignee: 'u42' }, e)).toBe(true);
  });
  it('fails the assignee filter when the owner is not an assignee', () => {
    const e = { ...event, details: { assigneeIds: ['u9'] } };
    expect(matchesFilters({ assignee: 'u42' }, e)).toBe(false);
  });
  it('fails the assignee filter when no assignee ids were exposed', () => {
    expect(matchesFilters({ assignee: 'u42' }, event)).toBe(false);
  });
});
