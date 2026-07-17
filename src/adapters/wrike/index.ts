import { randomBytes } from 'node:crypto';

import { config } from '../../config/index.js';
import { verifyHexHmac } from '../../crypto/index.js';
import type { Container, StatusDef, UnifiedEvent, UnifiedTask } from '../../models/unified.js';
import { currentConnection } from '../context.js';
import { providerFetch } from '../http.js';
import type { ProviderAdapter } from '../provider-adapter.js';
import type {
  AccountInfo,
  AdapterCapabilities,
  Connection,
  CreateTaskInput,
  CredentialField,
  HandshakeResponse,
  ProviderCredentials,
  RateLimitConfig,
  TaskPatch,
  TaskRef,
  WebhookHeaders,
  WebhookRef,
  WebhookScope,
} from '../types.js';
import { getHeader } from '../types.js';
import {
  mapWrikeCustomStatus,
  parseWrikeEvents,
  type WrikeCustomStatus,
  type WrikeTask,
  type WrikeWebhookPayload,
  type WrikeWorkflow,
} from './mapping.js';

const BASE = 'https://www.wrike.com/api/v4';

/**
 * Wrike adapter (spec §4.2). Bearer token; batched events; handshake on
 * registration; we generate the webhook secret; custom workflows for statuses.
 */
export class WrikeAdapter implements ProviderAdapter {
  readonly id = 'wrike';

  capabilities(): AdapterCapabilities {
    return { webhookSetup: 'auto', payload: 'minimal' };
  }

  credentialFields(): CredentialField[] {
    return [{ key: 'token', label: 'Wrike Permanent Access Token', type: 'token', required: true }];
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  /**
   * Wrike sends an empty-body verification request (with X-Hook-Secret) at
   * registration; we echo the header. Non-empty body → notification (return null).
   */
  handleHandshake(headers: WebhookHeaders, rawBody?: Buffer): HandshakeResponse | null {
    if (rawBody && rawBody.length > 0) return null;
    const secret = getHeader(headers, 'x-hook-secret');
    if (!secret) return null;
    return { status: 200, headers: { 'X-Hook-Secret': secret } };
  }

  /** Notification signature: X-Hook-Secret = HMAC-SHA256(body, our secret). */
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean {
    const signature = getHeader(headers, 'x-hook-secret');
    if (!signature) return false;
    return verifyHexHmac(secret, rawBody, signature);
  }

  extractWebhookId(payload: unknown): string | undefined {
    if (!Array.isArray(payload)) return undefined;
    const first = (payload as Array<{ webhookId?: string }>)[0];
    return first?.webhookId;
  }

  parseEvents(payload: unknown, _headers: WebhookHeaders): UnifiedEvent[] {
    return parseWrikeEvents((payload as WrikeWebhookPayload) ?? []);
  }

  async enrichEvent(event: UnifiedEvent, creds: ProviderCredentials): Promise<UnifiedEvent> {
    const task = await this.getRawTask(creds, event.taskId);
    const statusMap = await this.getStatusMap(creds);
    const fromEvent = typeof event.details.customStatusId === 'string'
      ? statusMap.get(event.details.customStatusId)
      : undefined;
    const status = fromEvent ?? (task.customStatusId ? statusMap.get(task.customStatusId) : undefined);
    return {
      ...event,
      taskName: task.title,
      taskUrl: task.permalink,
      containerId: task.parentIds?.[0] ? String(task.parentIds[0]) : event.containerId,
      details: {
        ...event.details,
        status: status?.name,
        assignees: task.responsibleIds ?? event.details.newResponsibles ?? [],
      },
    };
  }

  async registerWebhook(creds: ProviderCredentials, scope: WebhookScope): Promise<WebhookRef> {
    // We generate the secret (spec §4.2); account-level scope for Phase 1.
    const secret = randomBytes(32).toString('hex');
    const res = await this.call(creds, 'POST', '/webhooks', {
      body: JSON.stringify({ hookUrl: config.webhookUrlFor(this.id), secret }),
    });
    const arr = (res.data as { data?: Array<{ id?: string }> }).data ?? [];
    const id = arr[0]?.id;
    if (!id) throw new Error('Wrike registerWebhook: missing id in response');
    return { providerWebhookId: id, secret, scope: { level: scope.level, workspaceId: scope.workspaceId } };
  }

  async deleteWebhook(creds: ProviderCredentials, providerWebhookId: string): Promise<void> {
    await this.call(creds, 'DELETE', `/webhooks/${providerWebhookId}`);
  }

  // ── Task actions ───────────────────────────────────────────────────────────

  async verifyCredentials(creds: ProviderCredentials): Promise<AccountInfo> {
    const res = await this.call(creds, 'GET', '/contacts', { searchParams: { me: 'true' } });
    const me = (res.data as { data?: Array<{ id?: string; firstName?: string; lastName?: string; accountId?: string }> }).data?.[0];
    if (!me?.accountId) throw new Error('Wrike: invalid token (GET /contacts?me=true)');
    return {
      scopeId: me.accountId,
      externalId: me.id,
      displayName: [me.firstName, me.lastName].filter(Boolean).join(' ') || undefined,
    };
  }

  async createTask(creds: ProviderCredentials, input: CreateTaskInput): Promise<TaskRef> {
    const params: Record<string, string> = { title: input.name };
    if (input.description) params.description = input.description;
    if (input.dueDate) params.dates = JSON.stringify({ due: input.dueDate });
    if (input.assignees?.length) params.responsiblesAdd = JSON.stringify(input.assignees);
    const res = await this.call(creds, 'POST', `/folders/${input.containerId}/tasks`, { searchParams: params });
    const task = (res.data as { data?: WrikeTask[] }).data?.[0];
    if (!task) throw new Error('Wrike createTask: no task returned');
    return { id: task.id, url: task.permalink ?? `https://www.wrike.com/` };
  }

  async updateTask(creds: ProviderCredentials, taskId: string, patch: TaskPatch): Promise<void> {
    const params: Record<string, string> = {};
    if (patch.name !== undefined) params.title = patch.name;
    if (patch.description !== undefined) params.description = patch.description;
    if (patch.dueDate !== undefined) {
      params.dates = patch.dueDate === null ? '{}' : JSON.stringify({ due: patch.dueDate });
    }
    if (patch.addAssignees?.length) params.responsiblesAdd = JSON.stringify(patch.addAssignees);
    if (patch.removeAssignees?.length) params.responsiblesRemove = JSON.stringify(patch.removeAssignees);
    await this.call(creds, 'PUT', `/tasks/${taskId}`, { searchParams: params });
  }

  async setStatus(creds: ProviderCredentials, taskId: string, statusId: string): Promise<void> {
    await this.call(creds, 'PUT', `/tasks/${taskId}`, { searchParams: { customStatus: statusId } });
  }

  async addComment(creds: ProviderCredentials, taskId: string, text: string): Promise<void> {
    await this.call(creds, 'POST', `/tasks/${taskId}/comments`, { searchParams: { text } });
  }

  async getTask(creds: ProviderCredentials, taskId: string): Promise<UnifiedTask> {
    const task = await this.getRawTask(creds, taskId);
    const statusMap = await this.getStatusMap(creds);
    const status = task.customStatusId ? statusMap.get(task.customStatusId) : undefined;
    return {
      provider: this.id,
      id: task.id,
      name: task.title ?? task.id,
      description: task.description,
      status: status ?? { id: task.customStatusId ?? '', name: task.status ?? '', category: 'open' },
      assignees: task.responsibleIds ?? [],
      dueDate: task.dates?.due,
      url: task.permalink ?? '',
      containerId: task.parentIds?.[0] ? String(task.parentIds[0]) : '',
    };
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  async listContainers(creds: ProviderCredentials, parentId?: string): Promise<Container[]> {
    const accountId = parentId ?? currentConnection()?.scopeId;
    if (!accountId) return [];

    const spaces = await this.getSpaces(creds);
    const containers: Container[] = [{ id: accountId, name: 'Account', kind: 'root', canContainTasks: false }];

    for (const space of spaces) {
      const spaceId = String(space.id ?? '');
      containers.push({ id: spaceId, name: space.title ?? spaceId, kind: 'space', canContainTasks: false, parentId: accountId });
      const folders = await this.getFolders(creds, spaceId);

      // folder.parentIds already encodes nesting; every folder can contain tasks.
      const childToParent = new Map<string, string>();
      for (const f of folders) {
        for (const cid of f.childIds ?? []) childToParent.set(String(cid), String(f.id ?? ''));
      }
      for (const f of folders) {
        const fid = String(f.id ?? '');
        containers.push({
          id: fid,
          name: f.title ?? fid,
          kind: 'folder',
          canContainTasks: true,
          parentId: childToParent.get(fid) ?? spaceId,
        });
      }
    }
    return containers;
  }

  async getAvailableStatuses(creds: ProviderCredentials, taskId: string): Promise<StatusDef[]> {
    const workflows = await this.getWorkflows(creds);
    const task = await this.getRawTask(creds, taskId);
    // Return the custom statuses of the workflow the task's current status belongs to.
    const owning = workflows.find((w) =>
      (w.customStatuses ?? []).some((s) => s.id === task.customStatusId),
    );
    const statuses = (owning?.customStatuses ?? workflows.flatMap((w) => w.customStatuses ?? []));
    return statuses.map(mapWrikeCustomStatus).filter((s): s is StatusDef => s !== null);
  }

  // ── Rate limiting ───────────────────────────────────────────────────────────

  rateLimit(_connection: Connection): RateLimitConfig {
    return { mode: 'dynamic', respectRetryAfter: true };
  }

  // ── API helpers ─────────────────────────────────────────────────────────────

  private authHeaders(creds: ProviderCredentials): Record<string, string> {
    return { Authorization: `Bearer ${creds.token ?? ''}`, 'Content-Type': 'application/json' };
  }

  private call(
    creds: ProviderCredentials,
    method: string,
    path: string,
    opts: { body?: string; searchParams?: Record<string, string> } = {},
  ) {
    return providerFetch(`${BASE}${path}`, {
      method,
      headers: this.authHeaders(creds),
      body: opts.body,
      searchParams: opts.searchParams,
    });
  }

  private async getRawTask(creds: ProviderCredentials, taskId: string): Promise<WrikeTask> {
    const res = await this.call(creds, 'GET', `/tasks/${taskId}`);
    const task = (res.data as { data?: WrikeTask[] }).data?.[0];
    if (!task) throw new Error(`Wrike: task ${taskId} not found`);
    return task;
  }

  private async getWorkflows(creds: ProviderCredentials): Promise<WrikeWorkflow[]> {
    const res = await this.call(creds, 'GET', '/workflows');
    return (res.data as { data?: WrikeWorkflow[] }).data ?? [];
  }

  /** Map of customStatusId → StatusDef, for enrich/task-card status mapping. */
  private async getStatusMap(creds: ProviderCredentials): Promise<Map<string, StatusDef>> {
    const workflows = await this.getWorkflows(creds);
    const map = new Map<string, StatusDef>();
    for (const w of workflows) {
      for (const s of w.customStatuses ?? []) {
        const mapped = mapWrikeCustomStatus(s as WrikeCustomStatus);
        if (mapped && s.id) map.set(s.id, mapped);
      }
    }
    return map;
  }

  private async getSpaces(creds: ProviderCredentials) {
    const res = await this.call(creds, 'GET', '/spaces');
    return (res.data as { data?: Array<{ id?: string; title?: string }> }).data ?? [];
  }

  private async getFolders(creds: ProviderCredentials, spaceId: string) {
    const res = await this.call(creds, 'GET', `/spaces/${spaceId}/folders`);
    return (res.data as { data?: Array<{ id?: string; title?: string; childIds?: string[] }> }).data ?? [];
  }
}
