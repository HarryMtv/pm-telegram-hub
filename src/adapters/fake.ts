import { verifyHexHmac } from '../crypto/index.js';
import type { Container, StatusDef, UnifiedEvent, UnifiedTask } from '../models/unified.js';
import type { ProviderAdapter } from './provider-adapter.js';
import type {
  AccountInfo,
  AdapterCapabilities,
  Connection,
  CreateTaskInput,
  CredentialField,
  ProviderCredentials,
  RateLimitConfig,
  TaskPatch,
  TaskRef,
  WebhookHeaders,
  WebhookRef,
  WebhookScope,
} from './types.js';

/**
 * In-process fake adapter for conformance testing. Implements the full
 * `ProviderAdapter` contract with canned behavior so the core pipeline can be
 * exercised without a real provider. Verification uses real HMAC (via the shared
 * crypto helper) so the signature path is genuinely tested.
 */
export interface FakeAdapterConfig {
  id?: string;
  capabilities?: AdapterCapabilities;
  events?: UnifiedEvent[];
  /** Map of taskId → enriched fields returned by enrichEvent/getTask. */
  tasks?: Record<string, Partial<UnifiedTask>>;
  statuses?: StatusDef[];
  secret?: string;
}

export class FakeAdapter implements ProviderAdapter {
  readonly id: string;
  private readonly caps: AdapterCapabilities;
  private readonly events: UnifiedEvent[];
  private readonly tasks: Record<string, Partial<UnifiedTask>>;
  private readonly statuses: StatusDef[];
  readonly secret: string;

  calls: { enrich: string[]; create: CreateTaskInput[] } = { enrich: [], create: [] };

  constructor(cfg: FakeAdapterConfig = {}) {
    this.id = cfg.id ?? 'fake';
    this.caps = cfg.capabilities ?? { webhookSetup: 'auto', payload: 'minimal' };
    this.events = cfg.events ?? [];
    this.tasks = cfg.tasks ?? {};
    this.statuses = cfg.statuses ?? [
      { id: 'open', name: 'Open', category: 'open' },
      { id: 'progress', name: 'In Progress', category: 'in_progress' },
      { id: 'done', name: 'Done', category: 'done' },
      { id: 'cancelled', name: 'Cancelled', category: 'cancelled' },
    ];
    this.secret = cfg.secret ?? 'fake-secret';
  }

  capabilities(): AdapterCapabilities {
    return this.caps;
  }

  credentialFields(): CredentialField[] {
    return [{ key: 'token', label: 'Fake Token', type: 'token', required: true }];
  }

  // No handshake for the fake.
  handleHandshake(): null {
    return null;
  }

  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean {
    const sig = headers['x-fake-signature'];
    const expected = typeof sig === 'string' ? sig : Array.isArray(sig) ? sig[0] : undefined;
    if (!expected) return false;
    return verifyHexHmac(secret, rawBody, expected);
  }

  extractWebhookId(payload: unknown): string | undefined {
    const p = payload as { webhook_id?: string } | undefined;
    return p?.webhook_id;
  }

  parseEvents(payload: unknown, _headers: WebhookHeaders): UnifiedEvent[] {
    if (Array.isArray(payload)) return payload as UnifiedEvent[];
    return this.events;
  }

  async enrichEvent(event: UnifiedEvent, _creds: ProviderCredentials): Promise<UnifiedEvent> {
    this.calls.enrich.push(event.taskId);
    const t = this.tasks[event.taskId];
    return {
      ...event,
      taskName: t?.name ?? event.taskName ?? `Task ${event.taskId}`,
      taskUrl: t?.url ?? event.taskUrl ?? `https://fake.test/t/${event.taskId}`,
      containerId: t?.containerId ?? event.containerId ?? 'fake-list',
    };
  }

  async registerWebhook(_creds: ProviderCredentials, scope: WebhookScope): Promise<WebhookRef> {
    return {
      providerWebhookId: `fake-hook-${scope.workspaceId}`,
      secret: this.secret,
      scope: { level: scope.level, workspaceId: scope.workspaceId },
    };
  }

  async deleteWebhook(): Promise<void> {}

  async verifyCredentials(_creds: ProviderCredentials): Promise<AccountInfo> {
    return { scopeId: 'fake-workspace', displayName: 'Fake User' };
  }

  async createTask(_creds: ProviderCredentials, input: CreateTaskInput): Promise<TaskRef> {
    this.calls.create.push(input);
    return {
      id: `task-${input.name.toLowerCase().replace(/\s+/g, '-')}`,
      url: `https://fake.test/t/new`,
    };
  }

  async updateTask(
    _creds: ProviderCredentials,
    _taskId: string,
    _patch: TaskPatch,
  ): Promise<void> {}
  async setStatus(_creds: ProviderCredentials, _taskId: string, _statusId: string): Promise<void> {}
  async addComment(_creds: ProviderCredentials, _taskId: string, _text: string): Promise<void> {}

  async getTask(_creds: ProviderCredentials, taskId: string): Promise<UnifiedTask> {
    const t = this.tasks[taskId];
    return {
      provider: this.id,
      id: taskId,
      name: t?.name ?? `Task ${taskId}`,
      description: t?.description,
      status: this.statuses[0]!,
      assignees: t?.assignees ?? [],
      dueDate: t?.dueDate,
      url: t?.url ?? `https://fake.test/t/${taskId}`,
      containerId: t?.containerId ?? 'fake-list',
    };
  }

  async listContainers(_creds: ProviderCredentials, _parentId?: string): Promise<Container[]> {
    return [
      { id: 'fake-workspace', name: 'Fake Workspace', kind: 'space', canContainTasks: false },
      {
        id: 'fake-list',
        name: 'Fake List',
        kind: 'tasklist',
        canContainTasks: true,
        parentId: 'fake-workspace',
      },
    ];
  }

  async getAvailableStatuses(_creds: ProviderCredentials, _taskId: string): Promise<StatusDef[]> {
    return this.statuses;
  }

  rateLimit(_connection: Connection): RateLimitConfig {
    return { mode: 'fixed', rpm: 1000, respectRetryAfter: true };
  }
}
