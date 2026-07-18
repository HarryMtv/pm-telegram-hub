import { describe, expect, it } from 'vitest';

import type { UnifiedTask } from '../models/unified.js';
import { mergeTaskFeed } from './task-feed.js';

const task = (id: string): UnifiedTask => ({
  provider: 'fake',
  id,
  name: `Task ${id}`,
  status: { id: 'open', name: 'Open', category: 'open' },
  assignees: [],
  url: `https://x/${id}`,
  containerId: 'c',
});

describe('mergeTaskFeed', () => {
  it('tags each task with its connection id and merges connections', () => {
    const feed = mergeTaskFeed([
      { connectionId: 'a', tasks: [task('1'), task('2')] },
      { connectionId: 'b', tasks: [task('3')] },
    ]);
    expect(feed.map((t) => [t.id, t.connectionId])).toEqual([
      ['1', 'a'],
      ['2', 'a'],
      ['3', 'b'],
    ]);
  });

  it('skips failed connections (undefined tasks) for partial results', () => {
    const feed = mergeTaskFeed([
      { connectionId: 'a', tasks: [task('1')] },
      { connectionId: 'b' }, // failed fetch
    ]);
    expect(feed.map((t) => t.id)).toEqual(['1']);
  });

  it('applies a global limit after merging', () => {
    const feed = mergeTaskFeed(
      [{ connectionId: 'a', tasks: [task('1'), task('2'), task('3')] }],
      2,
    );
    expect(feed.map((t) => t.id)).toEqual(['1', '2']);
  });
});
