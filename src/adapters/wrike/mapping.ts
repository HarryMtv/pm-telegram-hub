import { createHash } from 'node:crypto';

import type { StatusCategory, StatusDef, UnifiedEvent, UnifiedEventType } from '../../models/unified.js';

/** Wrike webhook event name → unified event type (spec §4.2). */
export const WRIKE_EVENT_MAP: Record<string, UnifiedEventType> = {
  TaskCreated: 'task.created',
  TaskDeleted: 'task.deleted',
  TaskTitleChanged: 'task.updated',
  TaskDescriptionChanged: 'task.updated',
  TaskImportanceChanged: 'task.updated',
  TaskResponsiblesAdded: 'task.assigned',
  TaskResponsiblesRemoved: 'task.assigned',
  TaskStatusChanged: 'task.status_changed',
  TaskDatesChanged: 'task.due_changed',
  CommentAdded: 'comment.added',
};

export interface WrikeWebhookEvent {
  webhookId?: string;
  eventType?: string;
  taskId?: string;
  eventAuthorId?: string;
  lastUpdatedDate?: string;
  oldCustomStatusId?: string;
  customStatusId?: string;
  taskAuthorId?: string;
  commentId?: string;
  lastCommentId?: string;
  oldResponsibles?: string[];
  newResponsibles?: string[];
}

export type WrikeWebhookPayload = WrikeWebhookEvent[];

export function mapWrikeEvent(name?: string): UnifiedEventType {
  return WRIKE_EVENT_MAP[name ?? ''] ?? 'task.updated';
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/**
 * Wrike batches multiple events into one request (spec §4.2). Emit one unified
 * event per array element. dedupeKey = `eventType:taskId:lastUpdatedDate`
 * (plus old/new status ids for status events); sha256 fallback when no timestamp.
 */
export function parseWrikeEvents(payload: unknown, provider = 'wrike'): UnifiedEvent[] {
  if (!Array.isArray(payload)) return [];
  return (payload as WrikeWebhookEvent[]).map((e) => {
    const eventType = mapWrikeEvent(e.eventType);
    let dedupeKey: string;
    if (!e.lastUpdatedDate) {
      dedupeKey = `sha256:${sha256(JSON.stringify(e))}`;
    } else {
      dedupeKey = `${e.eventType}:${e.taskId}:${e.lastUpdatedDate}`;
      if (e.eventType === 'TaskStatusChanged') {
        dedupeKey += `:${e.oldCustomStatusId ?? ''}:${e.customStatusId ?? ''}`;
      }
    }
    return {
      provider,
      eventType,
      dedupeKey,
      taskId: e.taskId ?? '',
      actor: e.eventAuthorId,
      details: {
        webhookId: e.webhookId,
        oldCustomStatusId: e.oldCustomStatusId,
        customStatusId: e.customStatusId,
        commentId: e.commentId ?? e.lastCommentId,
        oldResponsibles: e.oldResponsibles,
        newResponsibles: e.newResponsibles,
        authorId: e.eventAuthorId,
      },
      raw: e,
    };
  });
}

/** Map a Wrike custom status group to a unified category (spec §4.2). */
export function mapWrikeStatusGroup(group?: string): StatusCategory {
  switch ((group ?? '').toLowerCase()) {
    case 'active':
      return 'in_progress';
    case 'completed':
      return 'done';
    case 'cancelled':
      return 'cancelled';
    case 'deferred':
      return 'open';
    default:
      return 'open';
  }
}

export interface WrikeCustomStatus {
  id?: string;
  name?: string;
  group?: string;
  color?: string;
  hidden?: boolean;
}

/** Map a Wrike workflow custom status to a unified StatusDef. */
export function mapWrikeCustomStatus(s: WrikeCustomStatus): StatusDef | null {
  if (!s.id) return null;
  return { id: s.id, name: s.name ?? s.id, category: mapWrikeStatusGroup(s.group) };
}

export interface WrikeWorkflow {
  id?: string;
  name?: string;
  customStatuses?: WrikeCustomStatus[];
}

export interface WrikeTask {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  customStatusId?: string;
  permalink?: string;
  parentIds?: string[];
  responsibleIds?: string[];
  dates?: { due?: string; start?: string; type?: string };
}
