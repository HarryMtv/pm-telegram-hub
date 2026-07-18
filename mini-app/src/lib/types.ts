export type StatusCategory = 'open' | 'in_progress' | 'done' | 'cancelled';

export interface StatusDef {
  id: string;
  name: string;
  category: StatusCategory;
}

export interface CredentialField {
  key: string;
  label: string;
  type: 'token' | 'text' | 'url' | 'password';
  placeholder?: string;
}

export interface AdapterMeta {
  id: string;
  capabilities: { webhookSetup: 'auto' | 'admin-required'; payload: 'rich' | 'minimal' };
  credentialFields: CredentialField[];
}

export interface Connection {
  id: string;
  provider: string;
  isActive: boolean;
}

export interface Container {
  id: string;
  name: string;
  kind: 'root' | 'space' | 'folder' | 'tasklist';
  canContainTasks: boolean;
  parentId?: string;
}

export interface Subscription {
  id: string;
  connectionId: string;
  eventTypes: string[];
  filters: Record<string, unknown>;
  isActive: boolean;
}

export interface Mapping {
  id: string;
  provider: string;
  alias: string;
  containerId: string;
  isDefault: boolean;
}

export interface FeedTask {
  connectionId: string;
  provider: string;
  id: string;
  name: string;
  description?: string;
  status: StatusDef;
  assignees: string[];
  dueDate?: string;
  url: string;
  containerId: string;
}

/** Unified webhook event types (spec §2.2) — kept in sync with the backend. */
export const EVENT_TYPES: { value: string; label: string }[] = [
  { value: 'task.created', label: 'Task created' },
  { value: 'task.updated', label: 'Task updated' },
  { value: 'task.assigned', label: 'Task assigned' },
  { value: 'task.status_changed', label: 'Status changed' },
  { value: 'task.due_changed', label: 'Due date changed' },
  { value: 'comment.added', label: 'Comment added' },
];
