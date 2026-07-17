import { config } from '../../config/index.js';
import { verifyHexHmac } from '../../crypto/index.js';
import type { Container, StatusDef, UnifiedEvent, UnifiedTask } from '../../models/unified.js';
import { currentConnection } from '../context.js';
import { providerFetch } from '../http.js';
import type { ProviderAdapter } from '../provider-adapter.js';
import type {
  AccountInfo,
  AdapterCapabilities,
  CommentOptions,
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
} from '../types.js';
import { getHeader } from '../types.js';
import {
  CLICKUP_WEBHOOK_EVENTS,
  mapClickUpStatus,
  parseClickUpEvents,
  type ClickUpTask,
  type ClickUpWebhookPayload,
} from './mapping.js';

const BASE = 'https://api.clickup.com/api/v2';

/** ClickUp adapter (spec §4.1). Personal token; one event per request; minimal payload. */
export class ClickUpAdapter implements ProviderAdapter {
  readonly id = 'clickup';

  capabilities(): AdapterCapabilities {
    return { webhookSetup: 'auto', payload: 'minimal' };
  }

  credentialFields(): CredentialField[] {
    return [{ key: 'token', label: 'ClickUp Personal Token', type: 'token', required: true }];
  }

  // No handshake for ClickUp.
  handleHandshake(): null {
    return null;
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean {
    const signature = getHeader(headers, 'x-signature');
    if (!signature) return false;
    return verifyHexHmac(secret, rawBody, signature);
  }

  extractWebhookId(payload: unknown): string | undefined {
    return (payload as ClickUpWebhookPayload | undefined)?.webhook_id;
  }

  parseEvents(payload: unknown, _headers: WebhookHeaders): UnifiedEvent[] {
    return parseClickUpEvents((payload as ClickUpWebhookPayload) ?? {});
  }

  async enrichEvent(event: UnifiedEvent, creds: ProviderCredentials): Promise<UnifiedEvent> {
    const task = await this.getRawTask(creds, event.taskId);
    return {
      ...event,
      taskName: task.name,
      taskUrl: task.url,
      containerId: task.list ? String(task.list.id) : event.containerId,
      details: {
        ...event.details,
        status: task.status?.status,
        assignees: (task.assignees ?? []).map((a) => a.username ?? String(a.id)),
        // Stable assignee user ids — drive the subscription "assigned to me" filter
        // (filters.assignee). Kept here so the worker compares ids without naming ClickUp.
        assigneeIds: (task.assignees ?? []).map((a) => String(a.id)),
      },
    };
  }

  async registerWebhook(creds: ProviderCredentials, scope: WebhookScope): Promise<WebhookRef> {
    const teamId = scope.workspaceId;
    const res = await this.call(creds, 'POST', `/team/${teamId}/webhook`, {
      body: JSON.stringify({
        endpoint: config.webhookUrlFor(this.id),
        events: CLICKUP_WEBHOOK_EVENTS,
      }),
    });
    // ClickUp wraps the created webhook in a `webhook` object: { webhook: { id, secret, ... } }.
    // On a duplicate config it returns { err, ECODE: "OAUTH_171" } (HTTP 400).
    const data = res.data as {
      id?: string;
      secret?: string;
      webhook?: { id?: string; secret?: string };
      err?: string;
      ECODE?: string;
    };
    const wh = data.webhook ?? { id: data.id, secret: data.secret };
    if (!wh.id || !wh.secret) {
      const why = data.err
        ? `${data.err}${data.ECODE ? ` (${data.ECODE})` : ''}`
        : 'provider response missing id/secret';
      throw new Error(`ClickUp registerWebhook: ${why}`);
    }
    return { providerWebhookId: wh.id, secret: wh.secret, scope: { teamId } };
  }

  async deleteWebhook(creds: ProviderCredentials, providerWebhookId: string): Promise<void> {
    // ClickUp's delete endpoint is team-less: DELETE /webhook/{webhook_id}
    // (the /team/{id}/webhook/{id} path returns 404 — it does not exist for DELETE).
    await this.call(creds, 'DELETE', `/webhook/${providerWebhookId}`);
  }

  // ── Task actions ───────────────────────────────────────────────────────────

  async verifyCredentials(creds: ProviderCredentials): Promise<AccountInfo> {
    const user = await this.getUser(creds);
    const teams = await this.getTeams(creds);
    const team = teams[0];
    if (!team) throw new Error('ClickUp: token has no accessible teams');
    return {
      scopeId: String(team.id),
      externalId: String(user.id),
      displayName: user.username,
    };
  }

  async createTask(creds: ProviderCredentials, input: CreateTaskInput): Promise<TaskRef> {
    const res = await this.call(creds, 'POST', `/list/${input.containerId}/task`, {
      body: JSON.stringify({
        name: input.name,
        description: input.description,
        assignees: input.assignees ?? [],
        due_date: input.dueDate ? Date.parse(input.dueDate) : undefined,
        status: input.statusId,
      }),
    });
    const task = res.data as ClickUpTask;
    return { id: String(task.id), url: task.url };
  }

  async updateTask(creds: ProviderCredentials, taskId: string, patch: TaskPatch): Promise<void> {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.dueDate !== undefined) {
      body.due_date = patch.dueDate === null ? null : Date.parse(patch.dueDate);
    }
    if (patch.addAssignees?.length || patch.removeAssignees?.length) {
      body.assignees = { add: patch.addAssignees ?? [], rem: patch.removeAssignees ?? [] };
    }
    await this.call(creds, 'PUT', `/task/${taskId}`, { body: JSON.stringify(body) });
  }

  async setStatus(creds: ProviderCredentials, taskId: string, statusId: string): Promise<void> {
    await this.call(creds, 'PUT', `/task/${taskId}`, {
      body: JSON.stringify({ status: statusId }),
    });
  }

  async addComment(
    creds: ProviderCredentials,
    taskId: string,
    text: string,
    opts: CommentOptions = {},
  ): Promise<void> {
    // A real ClickUp @mention (that pings) requires the rich `comment` array with
    // a `tag` element per mentioned user id; plain `comment_text` only renders text.
    const mentions = (opts.mentions ?? [])
      .map((id) => Number(id))
      .filter((n) => Number.isInteger(n));
    const body =
      mentions.length > 0
        ? {
            comment: [...mentions.map((id) => ({ type: 'tag', user: { id } })), { text }],
            notify_all: false,
          }
        : { comment_text: text };
    await this.call(creds, 'POST', `/task/${taskId}/comment`, { body: JSON.stringify(body) });
  }

  async getTask(creds: ProviderCredentials, taskId: string): Promise<UnifiedTask> {
    const task = await this.getRawTask(creds, taskId);
    return this.toUnifiedTask(task);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  async listContainers(creds: ProviderCredentials, parentId?: string): Promise<Container[]> {
    const teamId = parentId ?? currentConnection()?.scopeId;
    if (!teamId) return [];

    const spaces = await this.getSpaces(creds, teamId);
    const containers: Container[] = [
      { id: teamId, name: 'Team', kind: 'space', canContainTasks: false },
    ];

    for (const space of spaces) {
      const spaceId = String(space.id);
      containers.push({
        id: spaceId,
        name: space.name ?? spaceId,
        kind: 'space',
        canContainTasks: false,
        parentId: teamId,
      });
      const [folders, folderlessLists] = await Promise.all([
        this.getFolders(creds, spaceId),
        this.getLists(creds, `/space/${spaceId}/list`),
      ]);
      for (const list of folderlessLists) {
        containers.push(this.listContainer(String(list.id), list.name ?? String(list.id), spaceId));
      }
      for (const folder of folders) {
        const folderId = String(folder.id);
        containers.push({
          id: folderId,
          name: folder.name ?? folderId,
          kind: 'folder',
          canContainTasks: false,
          parentId: spaceId,
        });
        const lists = await this.getLists(creds, `/folder/${folderId}/list`);
        for (const list of lists) {
          containers.push(
            this.listContainer(String(list.id), list.name ?? String(list.id), folderId),
          );
        }
      }
    }
    return containers;
  }

  private listContainer(id: string, name: string, parentId: string): Container {
    return { id, name, kind: 'tasklist', canContainTasks: true, parentId };
  }

  async getAvailableStatuses(creds: ProviderCredentials, taskId: string): Promise<StatusDef[]> {
    const task = await this.getRawTask(creds, taskId);
    const listId = task.list?.id;
    if (!listId) return [];
    const res = await this.call(creds, 'GET', `/list/${listId}`);
    const statuses =
      (res.data as { statuses?: Array<{ status?: string; type?: string }> }).statuses ?? [];
    return statuses.map(mapClickUpStatus).filter((s): s is StatusDef => s !== null);
  }

  // ── Rate limiting ───────────────────────────────────────────────────────────

  rateLimit(_connection: Connection): RateLimitConfig {
    return { mode: 'fixed', rpm: config.rateLimitDefaults.clickup, respectRetryAfter: true };
  }

  // ── API helpers ─────────────────────────────────────────────────────────────

  private authHeaders(creds: ProviderCredentials): Record<string, string> {
    return { Authorization: String(creds.token ?? ''), 'Content-Type': 'application/json' };
  }

  private call(
    creds: ProviderCredentials,
    method: string,
    path: string,
    opts: { body?: string } = {},
  ) {
    return providerFetch(`${BASE}${path}`, {
      method,
      headers: this.authHeaders(creds),
      body: opts.body,
    });
  }

  private async getUser(
    creds: ProviderCredentials,
  ): Promise<{ id: string | number; username?: string }> {
    const res = await this.call(creds, 'GET', '/user');
    const user = (res.data as { user?: { id: string | number; username?: string } }).user;
    if (!user) throw new Error('ClickUp: invalid token (GET /user)');
    return user;
  }

  private async getTeams(
    creds: ProviderCredentials,
  ): Promise<Array<{ id: string | number; name?: string }>> {
    const res = await this.call(creds, 'GET', '/team');
    return (res.data as { teams?: Array<{ id: string | number; name?: string }> }).teams ?? [];
  }

  private async getRawTask(creds: ProviderCredentials, taskId: string): Promise<ClickUpTask> {
    const res = await this.call(creds, 'GET', `/task/${taskId}`);
    return res.data as ClickUpTask;
  }

  private async getSpaces(creds: ProviderCredentials, teamId: string) {
    const res = await this.call(creds, 'GET', `/team/${teamId}/space`);
    return (res.data as { spaces?: Array<{ id: string | number; name?: string }> }).spaces ?? [];
  }

  private async getFolders(creds: ProviderCredentials, spaceId: string) {
    const res = await this.call(creds, 'GET', `/space/${spaceId}/folder`);
    return (res.data as { folders?: Array<{ id: string | number; name?: string }> }).folders ?? [];
  }

  private async getLists(creds: ProviderCredentials, pathPrefix: string) {
    const res = await this.call(creds, 'GET', pathPrefix);
    return (res.data as { lists?: Array<{ id: string | number; name?: string }> }).lists ?? [];
  }

  private toUnifiedTask(task: ClickUpTask): UnifiedTask {
    const statusName = task.status?.status ?? '';
    const mapped = mapClickUpStatus(task.status ?? { status: statusName });
    return {
      provider: this.id,
      id: String(task.id),
      name: task.name,
      description: task.description,
      status: {
        id: statusName,
        name: statusName,
        category: mapped?.category ?? 'open',
      },
      assignees: (task.assignees ?? []).map((a) => a.username ?? String(a.id)),
      dueDate: task.due_date ? String(task.due_date) : undefined,
      url: task.url,
      containerId: task.list ? String(task.list.id) : '',
    };
  }
}
