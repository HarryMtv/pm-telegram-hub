import { createHash } from 'node:crypto';

import type {
  StatusCategory,
  StatusDef,
  UnifiedEvent,
  UnifiedEventType,
} from '../../models/unified.js';
import { getHeader, type WebhookHeaders } from '../types.js';

export interface JiraWebhookPayload {
  webhookEvent?: string; // jira:issue_updated | jira:issue_created | jira:issue_deleted | comment_created
  webhook_id?: string;
  issue?: {
    key?: string;
    id?: string;
    fields?: {
      summary?: string;
      status?: { name?: string; statusCategory?: { key?: string } };
      assignee?: { accountId?: string; displayName?: string } | null;
      duedate?: string;
      project?: { id?: string; key?: string; name?: string };
      description?: unknown; // ADF
    };
  };
  changelog?: { items?: Array<{ field?: string; fromString?: string; toString?: string }> };
  user?: { displayName?: string; key?: string; accountId?: string; name?: string };
  comment?: { id?: string; body?: unknown };
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

function mapChangelogField(field?: string): UnifiedEventType | null {
  switch ((field ?? '').toLowerCase()) {
    case 'status':
      return 'task.status_changed';
    case 'assignee':
      return 'task.assigned';
    case 'duedate':
      return 'task.due_changed';
    default:
      return null;
  }
}

/**
 * Jira is a 'rich'-payload provider: the issue ships whole, so no enrich fetch is
 * needed. A single `jira:issue_updated` with a changelog expands into N unified
 * events (status/assignee/due/updated). dedupeKey uses the delivery id header
 * (Jira retries deliveries) + the changelog-item index.
 */
export function parseJiraEvents(
  payload: JiraWebhookPayload,
  headers: WebhookHeaders,
  provider = 'jira',
): UnifiedEvent[] {
  const event = payload.webhookEvent;
  if (!event) return [];

  const issue = payload.issue;
  const taskId = issue?.key ?? '';
  const actor = payload.user?.displayName ?? payload.user?.key ?? payload.user?.name;
  const containerId = issue?.fields?.project?.id;
  const summary = issue?.fields?.summary;
  const deliveryId = getHeader(headers, 'x-atlassian-webhook-identifier') ?? '';
  const dedupe = (suffix: string): string =>
    deliveryId
      ? `${deliveryId}:${suffix}`
      : `sha256:${sha256(JSON.stringify({ event, taskId, suffix }))}`;

  const base = { provider, taskId, taskName: summary, actor, containerId, raw: payload };

  if (event === 'comment_created') {
    return [
      {
        ...base,
        eventType: 'comment.added',
        dedupeKey: dedupe(`comment:${payload.comment?.id ?? ''}`),
        details: { commentId: payload.comment?.id, body: payload.comment?.body },
      },
    ];
  }
  if (event === 'jira:issue_created') {
    return [{ ...base, eventType: 'task.created', dedupeKey: dedupe('created'), details: {} }];
  }
  if (event === 'jira:issue_deleted') {
    return [{ ...base, eventType: 'task.deleted', dedupeKey: dedupe('deleted'), details: {} }];
  }
  if (event === 'jira:issue_updated') {
    const items = payload.changelog?.items ?? [];
    if (items.length === 0) {
      return [{ ...base, eventType: 'task.updated', dedupeKey: dedupe('updated:0'), details: {} }];
    }
    return items.map((item, idx) => {
      const eventType = mapChangelogField(item.field) ?? 'task.updated';
      return {
        ...base,
        eventType,
        dedupeKey: dedupe(`${eventType}:${idx}`),
        details: { field: item.field, old: item.fromString, new: item.toString },
      };
    });
  }
  return [{ ...base, eventType: 'task.updated', dedupeKey: dedupe(event), details: {} }];
}

/** Jira statusCategory → unified category (spec §4.3). */
export function mapJiraStatusCategory(key?: string): StatusCategory {
  switch ((key ?? '').toLowerCase()) {
    case 'indeterminate':
      return 'in_progress';
    case 'done':
      return 'done';
    case 'new':
    case 'to_do':
    case 'todo':
      return 'open';
    default:
      return 'open';
  }
}

export interface JiraTransition {
  id?: string;
  name?: string;
  to?: { name?: string; statusCategory?: { key?: string } };
}

export function mapJiraTransition(t: JiraTransition): StatusDef | null {
  if (!t.id) return null;
  return {
    id: t.id,
    name: t.to?.name ?? t.name ?? t.id,
    category: mapJiraStatusCategory(t.to?.statusCategory?.key),
  };
}

/** Atlassian Document Format (JSON tree) → plain text, best-effort. */
export function adfToText(adf: unknown): string {
  if (typeof adf === 'string') return adf;
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.text === 'string') parts.push(obj.text);
    const content = obj.content;
    if (Array.isArray(content)) for (const child of content) walk(child);
  };
  walk(adf);
  return parts.join(' ').trim();
}

/** Plain text → a minimal ADF document (for addComment). */
export function textToAdf(text: string): { type: string; version: number; content: unknown[] } {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}
