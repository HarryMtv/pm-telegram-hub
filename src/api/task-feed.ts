import type { UnifiedTask } from '../models/unified.js';

/** A unified task tagged with the connection it came from (Mini App needs it for
 * per-connection detail/action routes). */
export type FeedTask = UnifiedTask & { connectionId: string };

export interface ConnectionTaskResult {
  connectionId: string;
  /** Fulfilled task list, or undefined when that connection's fetch failed. */
  tasks?: UnifiedTask[];
}

/**
 * Merge per-connection `listTasks` results into one feed. A failed connection
 * (undefined tasks) is skipped so the inbox degrades to partial results rather
 * than failing wholesale. Applies an optional global cap after merging.
 */
export function mergeTaskFeed(results: ConnectionTaskResult[], limit?: number): FeedTask[] {
  const feed: FeedTask[] = [];
  for (const { connectionId, tasks } of results) {
    for (const task of tasks ?? []) feed.push({ ...task, connectionId });
  }
  return limit ? feed.slice(0, limit) : feed;
}
