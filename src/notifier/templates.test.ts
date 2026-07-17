import { describe, expect, it } from 'vitest';

import type { UnifiedEvent } from '../models/unified.js';

import { escapeHtml, providerLabel, renderEvent } from './templates.js';

describe('escapeHtml / providerLabel', () => {
  it('escapes the three HTML-special characters', () => {
    expect(escapeHtml('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
  });
  it('maps known providers and capitalizes unknown', () => {
    expect(providerLabel('clickup')).toBe('ClickUp');
    expect(providerLabel('wrike')).toBe('Wrike');
    expect(providerLabel('linear')).toBe('Linear');
  });
});

describe('renderEvent', () => {
  const base = {
    provider: 'clickup',
    dedupeKey: 'dk',
    taskId: 't1',
    raw: {},
  } satisfies Partial<UnifiedEvent>;

  it('renders task.status_changed with badge, escaped name, link, and old → new', () => {
    const text = renderEvent({
      ...base,
      eventType: 'task.status_changed',
      taskName: 'Fix bug <x>',
      taskUrl: 'https://clickup.com/c/t1',
      details: { old: 'Open', new: 'Done' },
    });
    expect(text).toContain('[ClickUp]');
    expect(text).toContain('Fix bug &lt;x&gt;');
    expect(text).toContain('Open → Done');
    expect(text).toContain('href="https://clickup.com/c/t1"');
  });

  it('renders comment.added with author and preview', () => {
    const text = renderEvent({
      ...base,
      eventType: 'comment.added',
      taskName: 'Review',
      actor: 'igor',
      details: { preview: 'looks good' },
    });
    expect(text).toContain('Comment on');
    expect(text).toContain('by igor');
    expect(text).toContain(': looks good');
  });

  it('renders task.assigned with assignee and actor', () => {
    const text = renderEvent({
      ...base,
      eventType: 'task.assigned',
      taskName: 'T',
      actor: 'alice',
      details: { assignee: 'bob' },
    });
    expect(text).toContain('→ bob');
    expect(text).toContain('by alice');
  });
});
