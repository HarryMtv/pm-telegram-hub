import { describe, expect, it } from 'vitest';

import { config } from '../../config/index.js';
import { hmacSha256 } from '../../crypto/index.js';
import { WrikeAdapter } from './index.js';
import {
  mapWrikeCustomStatus,
  mapWrikeEvent,
  mapWrikeStatusGroup,
  parseWrikeEvents,
  type WrikeWebhookEvent,
} from './mapping.js';

describe('Wrike event mapping', () => {
  it('maps Wrike events to unified types', () => {
    expect(mapWrikeEvent('TaskCreated')).toBe('task.created');
    expect(mapWrikeEvent('TaskStatusChanged')).toBe('task.status_changed');
    expect(mapWrikeEvent('TaskResponsiblesAdded')).toBe('task.assigned');
    expect(mapWrikeEvent('TaskDatesChanged')).toBe('task.due_changed');
    expect(mapWrikeEvent('TaskTitleChanged')).toBe('task.updated');
    expect(mapWrikeEvent('CommentAdded')).toBe('comment.added');
  });
});

describe('Wrike batched parseEvents', () => {
  const batch: WrikeWebhookEvent[] = [
    {
      webhookId: 'IEACW',
      eventType: 'TaskStatusChanged',
      taskId: 'IEAAA1',
      eventAuthorId: 'KUAA1',
      oldCustomStatusId: 's1',
      customStatusId: 's2',
      lastUpdatedDate: '2026-07-01T10:00:00Z',
    },
    {
      eventType: 'TaskCreated',
      taskId: 'IEAAA2',
      eventAuthorId: 'KUAA1',
      lastUpdatedDate: '2026-07-01T10:01:00Z',
    },
  ];

  it('emits one unified event per batched element', () => {
    const events = parseWrikeEvents(batch);
    expect(events).toHaveLength(2);
    expect(events[0]?.eventType).toBe('task.status_changed');
    expect(events[1]?.eventType).toBe('task.created');
  });

  it('builds dedupeKey from eventType:taskId:lastUpdatedDate (+ status ids)', () => {
    const events = parseWrikeEvents(batch);
    expect(events[0]?.dedupeKey).toBe('TaskStatusChanged:IEAAA1:2026-07-01T10:00:00Z:s1:s2');
    expect(events[1]?.dedupeKey).toBe('TaskCreated:IEAAA2:2026-07-01T10:01:00Z');
  });

  it('uses sha256 fallback when no lastUpdatedDate', () => {
    const [event] = parseWrikeEvents([{ eventType: 'TaskCreated', taskId: 'x' }]);
    expect(event?.dedupeKey).toMatch(/^sha256:/);
  });

  it('returns [] for non-array payloads', () => {
    expect(parseWrikeEvents({ not: 'array' })).toEqual([]);
  });
});

describe('Wrike status mapping', () => {
  it('maps custom status groups to unified categories', () => {
    expect(mapWrikeStatusGroup('Active')).toBe('in_progress');
    expect(mapWrikeStatusGroup('Completed')).toBe('done');
    expect(mapWrikeStatusGroup('Deferred')).toBe('open');
    expect(mapWrikeStatusGroup('Cancelled')).toBe('cancelled');
  });

  it('maps a custom status to a StatusDef', () => {
    expect(mapWrikeCustomStatus({ id: 'cs1', name: 'Done', group: 'Completed' })).toEqual({
      id: 'cs1',
      name: 'Done',
      category: 'done',
    });
  });
});

describe('Wrike adapter contract', () => {
  const adapter = new WrikeAdapter();

  it('reports minimal payload + auto webhook setup', () => {
    expect(adapter.capabilities()).toEqual({ webhookSetup: 'auto', payload: 'minimal' });
  });

  it('handshake verifies X-Hook-Signature and responds with hmac(secret, challenge)', () => {
    const secret = hmacSha256(config.encryptionKeyHex, 'wrike-webhook-signing').toString('hex');
    const body = Buffer.from('{"requestType": "WebHook secret verification"}');
    const signature = hmacSha256(secret, body).toString('hex');
    const challenge = 'abc123xyzChallenge';
    expect(
      adapter.handleHandshake({ 'x-hook-secret': challenge, 'x-hook-signature': signature }, body),
    ).toEqual({
      status: 200,
      headers: { 'X-Hook-Secret': hmacSha256(secret, challenge).toString('hex') },
    });
    // wrong X-Hook-Signature → discard
    expect(
      adapter.handleHandshake({ 'x-hook-secret': challenge, 'x-hook-signature': 'deadbeef' }, body),
    ).toBeNull();
    // event-array body → notification, not a handshake
    expect(
      adapter.handleHandshake(
        { 'x-hook-secret': challenge, 'x-hook-signature': signature },
        Buffer.from('[{}]'),
      ),
    ).toBeNull();
  });

  it('verifies notification X-Hook-Signature HMAC over the raw body', () => {
    const body = Buffer.from('[{"eventType":"TaskStatusChanged"}]');
    const signature = hmacSha256('our-secret', body).toString('hex');
    expect(adapter.verifyWebhook(body, { 'x-hook-signature': signature }, 'our-secret')).toBe(true);
    expect(adapter.verifyWebhook(body, { 'x-hook-signature': signature }, 'wrong')).toBe(false);
    expect(adapter.verifyWebhook(body, {}, 'our-secret')).toBe(false);
  });

  it('parses a batched payload through the adapter interface', () => {
    const events = adapter.parseEvents(
      [{ eventType: 'TaskCreated', taskId: 't1', lastUpdatedDate: '2026-07-01T00:00:00Z' }],
      {},
    );
    expect(events[0]?.eventType).toBe('task.created');
  });
});
