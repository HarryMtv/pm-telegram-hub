import { afterEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../config/index.js';
import { hmacSha256 } from '../../crypto/index.js';
import { WrikeAdapter } from './index.js';
import {
  mapWrikeCustomStatus,
  mapWrikeEvent,
  mapWrikeStatusGroup,
  parseWrikeEvents,
  wrikeHtmlToText,
  type WrikeWebhookEvent,
} from './mapping.js';

describe('Wrike HTML description → plain text', () => {
  it('returns undefined/empty passthrough for missing input', () => {
    expect(wrikeHtmlToText(undefined)).toBeUndefined();
    expect(wrikeHtmlToText('')).toBe('');
  });

  it('strips tags, decodes entities, and formats blocks/lists/links', () => {
    const html =
      '<h3><b>What Is a Personal Space?</b></h3>It&#39;s a private part of the workspace.' +
      '<br /><br /><b><i>Remember:</i></b> stay private.<br /><br />' +
      '<ol><li>&#64;mention users. <a href="https://help.wrike.com/x">Learn how</a></li>' +
      '<li>Use the “<i>share&#34;</i> dialogue.</li></ol>';
    const out = wrikeHtmlToText(html);

    // No markup or raw entities survive.
    expect(out).not.toMatch(/[<>]/);
    expect(out).not.toContain('&#');
    // Entities decoded.
    expect(out).toContain("It's a private part");
    expect(out).toContain('@mention users');
    expect(out).toContain('share"');
    // Links rendered as "text (url)".
    expect(out).toContain('Learn how (https://help.wrike.com/x)');
    // List items become bullets.
    expect(out).toContain('• @mention users');
    // No runaway blank lines.
    expect(out).not.toMatch(/\n{3,}/);
  });
});

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

describe('Wrike enrichEvent comment body', () => {
  const adapter = new WrikeAdapter();
  const creds = { token: 'tok' };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Route the shared HTTP client's global fetch by Wrike API path. */
  function stubFetch(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
    const jsonResponse = (data: unknown) =>
      ({
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify(data),
      }) as unknown as Response;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const path = new URL(url).pathname.replace('/api/v4', '');
      for (const [prefix, data] of Object.entries(routes)) {
        if (path.startsWith(prefix)) return jsonResponse(data);
      }
      return jsonResponse({ data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock as unknown as ReturnType<typeof vi.fn>;
  }

  const commentEvent = () =>
    parseWrikeEvents([
      {
        webhookId: 'IEACW',
        eventType: 'CommentAdded',
        taskId: 'IEAAA1',
        eventAuthorId: 'KUAA1',
        commentId: 'C1',
        lastUpdatedDate: '2026-07-18T10:00:00Z',
      },
    ])[0]!;

  it('fetches the comment text as plain text into details.commentText', async () => {
    const fetchMock = stubFetch({
      '/tasks/': {
        data: [
          {
            id: 'IEAAA1',
            title: 'MUST-READ: How-to Guide',
            permalink: 'https://www.wrike.com/open.htm?id=1018695666',
            responsibleIds: [],
          },
        ],
      },
      '/workflows': { data: [] },
      '/contacts/': { data: [{ id: 'KUAA1', firstName: 'Igor', lastName: 'Test' }] },
      '/comments/': { data: [{ id: 'C1', text: 'Please review this doc' }] },
    });

    const enriched = await adapter.enrichEvent(commentEvent(), creds);

    expect(enriched.details.commentText).toBe('Please review this doc');
    // requests plainText=true so Wrike strips @mention/link HTML
    const commentCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/comments/'));
    expect(String(commentCall?.[0])).toContain('plainText=true');
  });

  it('degrades to no preview when the comment fetch fails', async () => {
    const jsonResponse = (data: unknown) =>
      ({
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify(data),
      }) as unknown as Response;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const path = new URL(url).pathname;
        if (path.includes('/comments/')) {
          return {
            status: 500,
            headers: new Headers(),
            text: async () => 'boom',
          } as unknown as Response;
        }
        if (path.includes('/tasks/'))
          return jsonResponse({ data: [{ id: 'IEAAA1', title: 'MUST-READ', responsibleIds: [] }] });
        return jsonResponse({ data: [] });
      }),
    );

    const enriched = await adapter.enrichEvent(commentEvent(), creds);

    expect(enriched.details.commentText).toBeUndefined();
    expect(enriched.taskName).toBe('MUST-READ');
  });

  it('does not fetch a comment for non-comment events', async () => {
    const fetchMock = stubFetch({
      '/tasks/': { data: [{ id: 'IEAAA2', title: 'Task', responsibleIds: [] }] },
      '/workflows': { data: [] },
    });

    const taskEvent = parseWrikeEvents([
      {
        eventType: 'TaskCreated',
        taskId: 'IEAAA2',
        eventAuthorId: 'KUAA1',
        lastUpdatedDate: '2026-07-18T10:00:00Z',
      },
    ])[0]!;
    const enriched = await adapter.enrichEvent(taskEvent, creds);

    expect(enriched.details.commentText).toBeUndefined();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/comments/'))).toBe(false);
  });
});
