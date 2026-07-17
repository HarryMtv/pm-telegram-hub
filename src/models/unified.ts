/**
 * Unified domain models (spec §2.2).
 *
 * The core (webhook endpoint, worker, notifier, bot, Mini App) operates ONLY on
 * these types. Any provider-specific knowledge lives inside an adapter and is
 * mapped to these shapes. If a core feature seems to need a provider name, the
 * adapter contract is wrong — redesign it.
 */

export type UnifiedEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.assigned'
  | 'task.status_changed'
  | 'task.due_changed'
  | 'comment.added';

export const ALL_EVENT_TYPES: UnifiedEventType[] = [
  'task.created',
  'task.updated',
  'task.deleted',
  'task.assigned',
  'task.status_changed',
  'task.due_changed',
  'comment.added',
];

export interface UnifiedEvent {
  provider: string;
  eventType: UnifiedEventType;
  /** Stable per-event id built by the adapter (spec §4); drives delivery idempotency. */
  dedupeKey: string;
  taskId: string;
  /** May be absent until `enrichEvent` runs for minimal-payload providers. */
  taskName?: string;
  taskUrl?: string;
  actor?: string;
  /** Stable provider id of whoever triggered the change (for self-echo suppression). */
  actorId?: string;
  /** Old/new status, assignees, comment preview, etc. — provider-dependent JSON. */
  details: Record<string, unknown>;
  /** Original provider payload (for debugging/audit; never sent to Telegram). */
  raw: unknown;
  /**
   * Unified container id of the task, populated by the adapter (usually during
   * enrich) so the worker can apply subscription container-filters without
   * knowing the provider hierarchy.
   */
  containerId?: string;
}

export type ContainerKind = 'root' | 'space' | 'folder' | 'tasklist';

export interface Container {
  id: string;
  name: string;
  kind: ContainerKind;
  /** ClickUp: only `tasklist`; Wrike: every folder; Jira: project. */
  canContainTasks: boolean;
  parentId?: string;
}

export type StatusCategory = 'open' | 'in_progress' | 'done' | 'cancelled';

export interface StatusDef {
  /** Provider-specific status id (or transition id for Jira). */
  id: string;
  name: string;
  category: StatusCategory;
}

export interface UnifiedTask {
  provider: string;
  id: string;
  name: string;
  /** Always plain text — adapters convert provider formats (e.g. Jira ADF) here. */
  description?: string;
  status: StatusDef;
  assignees: string[];
  dueDate?: string;
  url: string;
  containerId: string;
}
