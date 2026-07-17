import { describe, expect, it } from 'vitest';

import { hmacSha256 } from '../../crypto/index.js';
import { ClickUpAdapter } from './index.js';
import {
  mapClickUpEvent,
  mapClickUpStatus,
  parseClickUpEvents,
  type ClickUpWebhookPayload,
} from './mapping.js';

describe('ClickUp event mapping', () => {
  it('maps known ClickUp events to unified types', () => {
    expect(mapClickUpEvent('taskCreated')).toBe('task.created');
    expect(mapClickUpEvent('taskStatusUpdated')).toBe('task.status_changed');
    expect(mapClickUpEvent('taskAssigneeUpdated')).toBe('task.assigned');
    expect(mapClickUpEvent('taskDueDateUpdated')).toBe('task.due_changed');
    expect(mapClickUpEvent('taskCommentPosted')).toBe('comment.added');
  });

  it('falls back to task.updated for unknown events', () => {
    expect(mapClickUpEvent('taskTimeTracked')).toBe('task.updated');
    expect(mapClickUpEvent(undefined)).toBe('task.updated');
  });
});

describe('ClickUp parseEvents', () => {
  const payload: ClickUpWebhookPayload = {
    webhook_id: 'wh1',
    event: 'taskStatusUpdated',
    task_id: 'abc',
    history_items: [
      {
        id: 'h1',
        before: { status: 'Open' },
        after: { status: 'Done' },
        user: { id: 'u1', username: 'igor' },
      },
    ],
  };

  it('emits one unified event per history item with a stable dedupeKey', () => {
    const event = parseClickUpEvents(payload)[0]!;
    expect(event.eventType).toBe('task.status_changed');
    expect(event.dedupeKey).toBe('taskStatusUpdated:h1');
    expect(event.taskId).toBe('abc');
    expect(event.actor).toBe('igor');
    expect(event.details.after).toEqual({ status: 'Done' });
  });

  it('emits multiple events for multi-field updates', () => {
    const events = parseClickUpEvents({
      event: 'taskUpdated',
      task_id: 't',
      history_items: [{ id: 'a' }, { id: 'b' }],
    });
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.dedupeKey)).toEqual(['taskUpdated:a', 'taskUpdated:b']);
  });

  it('uses a sha256 fallback dedupeKey when no history id is present', () => {
    const event = parseClickUpEvents({
      event: 'taskCreated',
      task_id: 't',
      history_items: [{}],
    })[0]!;
    expect(event.dedupeKey).toMatch(/^sha256:/);
  });

  it('drops a status-only taskUpdated (covered by taskStatusUpdated)', () => {
    const events = parseClickUpEvents({
      event: 'taskUpdated',
      task_id: 't',
      history_items: [{ id: 'h1', field: 'status', before: 'Open', after: 'In Progress' }],
    });
    expect(events).toEqual([]);
  });

  it('keeps a taskUpdated for a generic field (name) not covered by a dedicated event', () => {
    const events = parseClickUpEvents({
      event: 'taskUpdated',
      task_id: 't',
      history_items: [{ id: 'h1', field: 'name', before: 'Old', after: 'New' }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('task.updated');
  });

  it('keeps only the generic items of a mixed taskUpdated', () => {
    const events = parseClickUpEvents({
      event: 'taskUpdated',
      task_id: 't',
      history_items: [
        { id: 'h1', field: 'status' },
        { id: 'h2', field: 'name' },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.details.field).toBe('name');
  });

  it('drops a comment-triggered taskUpdated (covered by taskCommentPosted)', () => {
    const events = parseClickUpEvents({
      event: 'taskUpdated',
      task_id: 't',
      history_items: [{ id: 'h1', field: 'comment', comment: { text: 'hi' } }],
    });
    expect(events).toEqual([]);
  });

  it('extracts the comment body into details.commentText', () => {
    const events = parseClickUpEvents({
      event: 'taskCommentPosted',
      task_id: 't',
      history_items: [
        {
          id: 'h1',
          field: 'comment',
          comment: { text_content: 'hello world', comment: [{ text: 'hello world' }] },
        },
      ],
    });
    expect(events[0]?.eventType).toBe('comment.added');
    expect(events[0]?.details.commentText).toBe('hello world');
  });
});

describe('ClickUp status mapping', () => {
  it('maps ClickUp status types to unified categories', () => {
    expect(mapClickUpStatus({ status: 'Open', type: 'todo' })?.category).toBe('open');
    expect(mapClickUpStatus({ status: 'In Progress', type: 'in progress' })?.category).toBe(
      'in_progress',
    );
    expect(mapClickUpStatus({ status: 'Done', type: 'closed' })?.category).toBe('done');
    expect(mapClickUpStatus({ status: 'Cancelled', type: 'closed' })?.category).toBe('cancelled');
  });

  it('uses the status name as the id (ClickUp sets status by name)', () => {
    expect(mapClickUpStatus({ status: 'Done', type: 'closed' })?.id).toBe('Done');
  });
});

describe('ClickUp adapter contract', () => {
  const adapter = new ClickUpAdapter();

  it('reports minimal payload + auto webhook setup', () => {
    expect(adapter.capabilities()).toEqual({ webhookSetup: 'auto', payload: 'minimal' });
  });

  it('verifies X-Signature HMAC over the raw body', () => {
    const body = Buffer.from('{"event":"taskStatusUpdated"}');
    const signature = hmacSha256('per-webhook-secret', body).toString('hex');
    expect(adapter.verifyWebhook(body, { 'x-signature': signature }, 'per-webhook-secret')).toBe(
      true,
    );
    expect(adapter.verifyWebhook(body, { 'x-signature': signature }, 'wrong-secret')).toBe(false);
    expect(adapter.verifyWebhook(body, {}, 'per-webhook-secret')).toBe(false);
  });

  it('parses through the adapter interface', () => {
    const events = adapter.parseEvents(
      { event: 'taskCreated', task_id: 'x', history_items: [{ id: '1' }] },
      {},
    );
    expect(events[0]?.eventType).toBe('task.created');
  });
});
