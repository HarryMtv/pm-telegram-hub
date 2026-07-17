import { createHash } from 'node:crypto';

import type {
  StatusCategory,
  StatusDef,
  UnifiedEvent,
  UnifiedEventType,
} from '../../models/unified.js';

/** ClickUp webhook event name → unified event type (spec §4.1). */
export const CLICKUP_EVENT_MAP: Record<string, UnifiedEventType> = {
  taskCreated: 'task.created',
  taskUpdated: 'task.updated',
  taskDeleted: 'task.deleted',
  taskAssigneeUpdated: 'task.assigned',
  taskStatusUpdated: 'task.status_changed',
  taskDueDateUpdated: 'task.due_changed',
  taskCommentPosted: 'comment.added',
  taskCommentUpdated: 'comment.added',
};

/** Events the adapter subscribes to when registering a webhook. */
export const CLICKUP_WEBHOOK_EVENTS = Object.keys(CLICKUP_EVENT_MAP);

export interface ClickUpHistoryItem {
  id?: string;
  field?: string;
  before?: unknown;
  after?: unknown;
  comment?: unknown;
  user?: { id?: string | number; username?: string; email?: string };
}

export interface ClickUpWebhookPayload {
  webhook_id?: string;
  event?: string;
  task_id?: string;
  history_items?: ClickUpHistoryItem[];
}

export function mapClickUpEvent(name?: string): UnifiedEventType {
  return CLICKUP_EVENT_MAP[name ?? ''] ?? 'task.updated';
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Plain text of a ClickUp comment object (text_content preferred; rich-text fallback). */
function commentBody(comment: unknown): string | undefined {
  if (!comment || typeof comment !== 'object') return undefined;
  const c = comment as { text_content?: unknown; comment?: Array<{ text?: unknown }> };
  if (typeof c.text_content === 'string' && c.text_content) return c.text_content;
  const first = c.comment?.[0];
  return typeof first?.text === 'string' && first.text ? first.text : undefined;
}

/**
 * Parse a ClickUp webhook payload (one event per request, spec §4.1). Returns one
 * unified event per history item so multi-field updates are not collapsed.
 * dedupeKey = `${event}:${history_item.id}`; sha256 fallback when no stable id.
 */
/** History-item fields covered by a dedicated ClickUp webhook event we subscribe
 * to (status→taskStatusUpdated, assignee→taskAssigneeUpdated, due_date→
 * taskDueDateUpdated, comment→taskCommentPosted/Updated). ClickUp fires the
 * generic `taskUpdated` ALONGSIDE these, so we drop the redundant generic items
 * to avoid double-notifying. */
const DEDICATED_FIELDS = new Set(['status', 'assignee', 'due_date', 'comment']);

export function parseClickUpEvents(
  payload: ClickUpWebhookPayload,
  provider = 'clickup',
): UnifiedEvent[] {
  const event = payload.event;
  const taskId = payload.task_id ?? '';
  let items = payload.history_items?.length ? payload.history_items : [{}];

  // ClickUp emits taskUpdated AND a dedicated event for one status/assignee/due
  // change. Keep only the items a dedicated event does NOT cover; if nothing
  // remains, the dedicated webhook carries it — so one change = one notification.
  if (event === 'taskUpdated' && payload.history_items?.length) {
    const generic = items.filter((it) => !DEDICATED_FIELDS.has(String(it.field)));
    if (generic.length === 0) return [];
    items = generic;
  }

  return items.map((item) => {
    const eventType = mapClickUpEvent(event);
    const dedupeKey = item.id
      ? `${event}:${item.id}`
      : `sha256:${sha256(JSON.stringify({ event, taskId, item }))}`;
    const actor = item.user?.username ?? item.user?.email;
    const actorId = item.user?.id != null ? String(item.user.id) : undefined;
    const commentText = commentBody(item.comment);

    return {
      provider,
      eventType,
      dedupeKey,
      taskId,
      actor,
      actorId,
      details: {
        field: item.field,
        before: item.before,
        after: item.after,
        userId: item.user?.id,
        commentText,
      },
      raw: { event, taskId, item },
    };
  });
}

export interface ClickUpStatus {
  status?: string;
  type?: string;
  order?: number;
  color?: string;
}

export interface ClickUpTask {
  id: string | number;
  name: string;
  url: string;
  description?: string;
  status?: ClickUpStatus;
  list?: { id: string | number; name?: string };
  assignees?: Array<{ id: string | number; username?: string }>;
  due_date?: string | number;
}

/** Map a ClickUp custom status to a unified StatusDef. ClickUp identifies
 * statuses by their name (used directly in PUT /task/{id} { status }). */
export function mapClickUpStatus(status: ClickUpStatus): StatusDef | null {
  const name = status.status;
  if (!name) return null;
  return { id: name, name, category: clickUpStatusCategory(status.type, name) };
}

function clickUpStatusCategory(type?: string, name = ''): StatusCategory {
  if (name.toLowerCase().includes('cancel')) return 'cancelled';
  switch ((type ?? '').toLowerCase()) {
    case 'todo':
    case 'open':
      return 'open';
    case 'in progress':
      return 'in_progress';
    case 'done':
    case 'closed':
    case 'complete':
      return 'done';
    default:
      return 'open';
  }
}
