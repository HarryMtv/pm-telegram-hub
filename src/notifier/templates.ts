import type { UnifiedEvent, UnifiedTask } from '../models/unified.js';

/** Escape the three characters Telegram HTML parse mode cares about. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Cap a string for Telegram display, appending an ellipsis if truncated. */
function truncate(input: string, max: number): string {
  return input.length > max ? `${input.slice(0, max - 1)}…` : input;
}

const str = (x: unknown): string | undefined => (typeof x === 'string' && x.length ? x : undefined);

function pickStr(...xs: unknown[]): string | undefined {
  for (const x of xs) {
    const s = str(x);
    if (s) return s;
  }
  return undefined;
}

function firstArr(x: unknown): string | undefined {
  return Array.isArray(x) && x.length ? str(x[0]) : undefined;
}

/** Human-readable provider badge (identical templates across providers). */
export function providerLabel(provider: string): string {
  const known: Record<string, string> = { clickup: 'ClickUp', wrike: 'Wrike', jira: 'Jira' };
  return known[provider] ?? escapeHtml(provider.charAt(0).toUpperCase() + provider.slice(1));
}

function taskLink(event: UnifiedEvent): string {
  const name = escapeHtml(event.taskName ?? event.taskId);
  return event.taskUrl ? `<a href="${event.taskUrl}">${name}</a>` : name;
}

function statusPair(details: Record<string, unknown>): { oldName?: string; newName?: string } {
  const before = details.before;
  const after = details.after;
  return {
    oldName: pickStr(details.old, typeof before === 'object' && before ? (before as { status?: string }).status : before, details.oldStatus),
    newName: pickStr(details.new, details.status, typeof after === 'object' && after ? (after as { status?: string }).status : after, details.newStatus),
  };
}

/**
 * Render a unified event into HTML parse-mode text (spec §6.2). Templates are
 * identical for every provider; only the badge differs. Fields are read
 * defensively from `details` so provider-specific JSON shapes degrade gracefully.
 */
export function renderEvent(event: UnifiedEvent): string {
  const badge = `[${providerLabel(event.provider)}]`;
  const link = taskLink(event);
  const d = event.details;

  switch (event.eventType) {
    case 'task.created': {
      const container = pickStr(d.container, d.listName, event.containerId);
      return `${badge} New task → ${link}${container ? `, ${escapeHtml(container)}` : ''}`;
    }
    case 'task.assigned': {
      const assignee = pickStr(d.assignee, firstArr(d.newResponsibles), firstArr(d.assignees));
      const actor = pickStr(event.actor, d.author, d.authorId);
      return `${badge} ${link} → ${assignee ? escapeHtml(assignee) : '?'}${actor ? `, by ${escapeHtml(actor)}` : ''}`;
    }
    case 'task.status_changed': {
      const { oldName, newName } = statusPair(d);
      return `${badge} ${link}: ${oldName ? escapeHtml(oldName) + ' → ' : ''}${newName ? escapeHtml(newName) : '?'}`;
    }
    case 'task.due_changed': {
      const date = pickStr(d.new, d.date, d.dueDate);
      return `${badge} ${link}: new due date ${date ? escapeHtml(date) : '?'}`;
    }
    case 'comment.added': {
      const author = pickStr(event.actor, d.author, d.authorId);
      const body = pickStr(d.commentText, d.preview, d.text);
      return `${badge} Comment on ${link}${author ? ` by ${escapeHtml(author)}` : ''}${body ? `: ${escapeHtml(truncate(body, 500))}` : ''}`;
    }
    case 'task.deleted':
      return `${badge} ${link}: deleted`;
    case 'task.updated':
    default:
      return `${badge} ${link}: updated`;
  }
}

/** Fuller card for `/task <id>` (name, status, assignees, due, description). */
export function renderTaskCard(task: UnifiedTask): string {
  const name = escapeHtml(task.name);
  const link = task.url ? `<a href="${task.url}">${name}</a>` : name;
  const lines = [`[${providerLabel(task.provider)}] ${link}`];
  lines.push(`Status: ${escapeHtml(task.status.name)} (${task.status.category})`);
  if (task.assignees.length) lines.push(`Assignees: ${task.assignees.map(escapeHtml).join(', ')}`);
  if (task.dueDate) lines.push(`Due: ${escapeHtml(task.dueDate)}`);
  if (task.description) lines.push('', escapeHtml(task.description.slice(0, 500)));
  return lines.join('\n');
}
