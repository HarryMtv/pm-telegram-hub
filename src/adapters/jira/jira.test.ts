import { describe, expect, it } from 'vitest';

import { hmacSha256 } from '../../crypto/index.js';
import { JiraAdapter } from './index.js';
import {
  adfToText,
  mapJiraStatusCategory,
  mapJiraTransition,
  parseJiraEvents,
  textToAdf,
  type JiraWebhookPayload,
} from './mapping.js';

const headers = (deliveryId?: string) =>
  deliveryId ? { 'x-atlassian-webhook-identifier': deliveryId } : {};

describe('Jira changelog expansion', () => {
  const payload: JiraWebhookPayload = {
    webhookEvent: 'jira:issue_updated',
    webhook_id: 'wh1',
    issue: { key: 'PROJ-1', fields: { summary: 'Fix login', project: { id: '10000' } } },
    changelog: {
      items: [
        { field: 'status', fromString: 'Open', toString: 'In Progress' },
        { field: 'assignee', fromString: '', toString: 'alice' },
      ],
    },
    user: { displayName: 'Igor' },
  };

  it('expands one updated webhook into multiple unified events', () => {
    const events = parseJiraEvents(payload, headers('deliv-1'));
    expect(events).toHaveLength(2);
    expect(events[0]?.eventType).toBe('task.status_changed');
    expect(events[1]?.eventType).toBe('task.assigned');
    expect(events[0]?.actor).toBe('Igor');
    expect(events[0]?.containerId).toBe('10000');
  });

  it('builds delivery-id + index dedupeKeys', () => {
    const events = parseJiraEvents(payload, headers('deliv-1'));
    expect(events[0]?.dedupeKey).toBe('deliv-1:task.status_changed:0');
    expect(events[1]?.dedupeKey).toBe('deliv-1:task.assigned:1');
  });

  it('dedupeKey is stable across a redelivery (same delivery id)', () => {
    const a = parseJiraEvents(payload, headers('deliv-1'));
    const b = parseJiraEvents(payload, headers('deliv-1'));
    expect(a.map((e) => e.dedupeKey)).toEqual(b.map((e) => e.dedupeKey));
  });

  it('maps created / deleted / comment events', () => {
    expect(
      parseJiraEvents(
        { webhookEvent: 'jira:issue_created', issue: { key: 'P-1' } },
        headers('d'),
      )[0]?.eventType,
    ).toBe('task.created');
    expect(
      parseJiraEvents(
        { webhookEvent: 'jira:issue_deleted', issue: { key: 'P-1' } },
        headers('d'),
      )[0]?.eventType,
    ).toBe('task.deleted');
    expect(
      parseJiraEvents(
        { webhookEvent: 'comment_created', issue: { key: 'P-1' }, comment: { id: 'c1' } },
        headers('d'),
      )[0]?.eventType,
    ).toBe('comment.added');
  });

  it('falls back to sha256 dedupeKey when no delivery id header', () => {
    const [event] = parseJiraEvents(
      { webhookEvent: 'jira:issue_created', issue: { key: 'P-1' } },
      {},
    );
    expect(event?.dedupeKey).toMatch(/^sha256:/);
  });
});

describe('Jira status mapping', () => {
  it('maps statusCategory keys', () => {
    expect(mapJiraStatusCategory('new')).toBe('open');
    expect(mapJiraStatusCategory('indeterminate')).toBe('in_progress');
    expect(mapJiraStatusCategory('done')).toBe('done');
  });

  it('maps a transition to a StatusDef', () => {
    const s = mapJiraTransition({
      id: '31',
      to: { name: 'Done', statusCategory: { key: 'done' } },
    });
    expect(s).toEqual({ id: '31', name: 'Done', category: 'done' });
  });
});

describe('ADF conversion', () => {
  it('converts text → ADF → text', () => {
    const adf = textToAdf('hello world');
    expect(adf.type).toBe('doc');
    expect(adfToText(adf)).toBe('hello world');
  });

  it('extracts text from a nested ADF tree', () => {
    expect(
      adfToText({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      }),
    ).toBe('a b');
  });
});

describe('Jira adapter contract', () => {
  const adapter = new JiraAdapter();

  it('reports admin webhooks + rich payload + 3 credential fields', () => {
    expect(adapter.capabilities()).toEqual({ webhookSetup: 'admin-required', payload: 'rich' });
    expect(adapter.credentialFields()).toHaveLength(3);
  });

  it('verifies X-Hub-Signature (sha256=<hex>) over the raw body', () => {
    const body = Buffer.from('{"webhookEvent":"jira:issue_updated"}');
    const sig = `sha256=${hmacSha256('our-secret', body).toString('hex')}`;
    expect(adapter.verifyWebhook(body, { 'x-hub-signature': sig }, 'our-secret')).toBe(true);
    expect(adapter.verifyWebhook(body, { 'x-hub-signature': sig }, 'wrong')).toBe(false);
    expect(adapter.verifyWebhook(body, { 'x-hub-signature': 'deadbeef' }, 'our-secret')).toBe(
      false,
    );
  });

  it('enrichEvent is a no-op (rich payload)', async () => {
    const event = {
      provider: 'jira',
      eventType: 'task.updated' as const,
      dedupeKey: 'd',
      taskId: 'P-1',
      details: {},
      raw: {},
    };
    expect(await adapter.enrichEvent(event, {})).toEqual(event);
  });

  it('extracts webhook_id from the payload', () => {
    expect(adapter.extractWebhookId({ webhook_id: 'wh-9' })).toBe('wh-9');
  });
});
