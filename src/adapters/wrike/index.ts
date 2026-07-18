import { config } from '../../config/index.js';
import { hmacSha256, verifyHexHmac } from '../../crypto/index.js';
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
   * Wrike Secure Webhook handshake (developers.wrike.com/docs/webhooks, confirmed
   * against the live API). The verification POST carries:
   *   X-Hook-Secret:   a random challenge Wrike generates (NOT our secret).
   *   X-Hook-Signature: hmacSha256(secret, request body).
   *   body: {"requestType": "WebHook secret verification"}.
   * We must verify X-Hook-Signature, then respond 200 with
   *   X-Hook-Secret: hmacSha256(secret, challenge)
   * — NOT the raw challenge. The signing secret is deterministic (derived from
   * ENCRYPTION_KEY) so it is known here without a DB lookup: the webhook row is not
   * persisted until after registration succeeds, so the handshake cannot resolve it.
   */
  handleHandshake(headers: WebhookHeaders, rawBody?: Buffer): HandshakeResponse | null {
    const body = rawBody ?? Buffer.from('');
    if (!body.toString('utf8').includes('WebHook secret verification')) return null;
    const secret = this.webhookSecret();
    const signature = getHeader(headers, 'x-hook-signature');
    if (!signature || !verifyHexHmac(secret, body, signature)) return null; // discard — not from Wrike
    const challenge = getHeader(headers, 'x-hook-secret');
    if (!challenge) return null;
    return {
      status: 200,
      headers: { 'X-Hook-Secret': hmacSha256(secret, challenge).toString('hex') },
    };
  }

  /** Notification signature: X-Hook-Signature = HMAC-SHA256(secret, body) over raw bytes. */
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean {
    const signature = getHeader(headers, 'x-hook-signature');
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
    const fromEvent =
      typeof event.details.customStatusId === 'string'
        ? statusMap.get(event.details.customStatusId)
        : undefined;
    const status =
      fromEvent ?? (task.customStatusId ? statusMap.get(task.customStatusId) : undefined);

    // Wrike webhooks carry only user ids; resolve them to display names once so
    // notifications read "by Igor" rather than "by KUAY…". Covers the event author
    // (actor) and the assignees. Best-effort — never blocks a notification.
    const ids = new Set<string>();
    if (event.actorId) ids.add(event.actorId);
    for (const id of task.responsibleIds ?? []) ids.add(id);
    for (const id of (event.details.newResponsibles as string[] | undefined) ?? []) ids.add(id);
    const names = ids.size
      ? await this.getContactNames(creds, [...ids])
      : new Map<string, string>();
    const name = (id?: string): string | undefined => (id ? (names.get(id) ?? id) : undefined);

    // Wrike webhooks carry only the comment id, not its text — fetch the body so
    // notifications read "…: <comment>". Best-effort; degrades to no preview.
    const commentId =
      event.eventType === 'comment.added' && typeof event.details.commentId === 'string'
        ? event.details.commentId
        : undefined;
    const commentText = commentId ? await this.getCommentText(creds, commentId) : undefined;

    return {
      ...event,
      taskName: task.title,
      taskUrl: task.permalink,
      containerId: task.parentIds?.[0] ? String(task.parentIds[0]) : event.containerId,
      actor: name(event.actorId) ?? event.actor,
      details: {
        ...event.details,
        status: status?.name,
        commentText,
        // assigneeIds is the canonical key the core's "assigned to me" filter reads
        // (worker.matchesFilters); assignees/newResponsibles are display names.
        assigneeIds: task.responsibleIds ?? [],
        assignees: (task.responsibleIds ?? []).map((id) => name(id) ?? id),
        newResponsibles: ((event.details.newResponsibles as string[] | undefined) ?? []).map(
          (id) => name(id) ?? id,
        ),
      },
    };
  }

  async registerWebhook(creds: ProviderCredentials, scope: WebhookScope): Promise<WebhookRef> {
    // Deterministic secret (derived from ENCRYPTION_KEY) so handleHandshake can
    // recompute it during the registration verification request, before the webhook
    // row is persisted. Account-level scope for Phase 1.
    const secret = this.webhookSecret();
    const res = await this.call(creds, 'POST', '/webhooks', {
      body: JSON.stringify({ hookUrl: config.webhookUrlFor(this.id), secret }),
    });
    const arr = (res.data as { data?: Array<{ id?: string }> }).data ?? [];
    const id = arr[0]?.id;
    if (!id) throw new Error('Wrike registerWebhook: missing id in response');
    return {
      providerWebhookId: id,
      secret,
      scope: { level: scope.level, workspaceId: scope.workspaceId },
    };
  }

  async deleteWebhook(creds: ProviderCredentials, providerWebhookId: string): Promise<void> {
    await this.call(creds, 'DELETE', `/webhooks/${providerWebhookId}`);
  }

  // ── Task actions ───────────────────────────────────────────────────────────

  async verifyCredentials(creds: ProviderCredentials): Promise<AccountInfo> {
    const res = await this.call(creds, 'GET', '/contacts', { searchParams: { me: 'true' } });
    const me = (
      res.data as {
        data?: Array<{
          id?: string;
          firstName?: string;
          lastName?: string;
          profiles?: Array<{ accountId?: string }>;
        }>;
      }
    ).data?.[0];
    // Wrike nests accountId under profiles[] (a contact may belong to several accounts),
    // not at the top level of the contact — confirmed against the live API.
    const accountId = me?.profiles?.find((p) => p.accountId)?.accountId;
    if (!me?.id || !accountId) throw new Error('Wrike: invalid token (GET /contacts?me=true)');
    return {
      scopeId: accountId,
      externalId: me.id,
      displayName: [me.firstName, me.lastName].filter(Boolean).join(' ') || undefined,
    };
  }

  async createTask(creds: ProviderCredentials, input: CreateTaskInput): Promise<TaskRef> {
    const params: Record<string, string> = { title: input.name };
    if (input.description) params.description = input.description;
    if (input.dueDate) params.dates = JSON.stringify({ due: input.dueDate });
    if (input.assignees?.length) params.responsiblesAdd = JSON.stringify(input.assignees);
    const res = await this.call(creds, 'POST', `/folders/${input.containerId}/tasks`, {
      searchParams: params,
    });
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
    if (patch.removeAssignees?.length)
      params.responsiblesRemove = JSON.stringify(patch.removeAssignees);
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
      status: status ?? {
        id: task.customStatusId ?? '',
        name: task.status ?? '',
        category: 'open',
      },
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
    const containers: Container[] = [
      { id: accountId, name: 'Account', kind: 'root', canContainTasks: false },
    ];

    for (const space of spaces) {
      const spaceId = String(space.id ?? '');
      containers.push({
        id: spaceId,
        name: space.title ?? spaceId,
        kind: 'space',
        canContainTasks: false,
        parentId: accountId,
      });
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
    const statuses = owning?.customStatuses ?? workflows.flatMap((w) => w.customStatuses ?? []);
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

  /**
   * Deterministic webhook signing secret, derived from ENCRYPTION_KEY. Stable across
   * process restarts and identical in registerWebhook (sent to Wrike, stored) and
   * handleHandshake (recomputed during the verification request). App-scoped to Wrike;
   * equivalent in trust to the per-webhook random it replaces, since the signing secret
   * is never disclosed and ENCRYPTION_KEY is already the root secret.
   */
  private webhookSecret(): string {
    return hmacSha256(config.encryptionKeyHex, 'wrike-webhook-signing').toString('hex');
  }

  /**
   * Resolve Wrike contact ids → "First Last" display names (GET /contacts/{id},{id},…
   * up to 100 ids per call). Webhook payloads carry only ids; this is best-effort —
   * any failure returns an empty map so enrichment degrades to ids, never blocking a
   * notification.
   */
  private async getContactNames(
    creds: ProviderCredentials,
    ids: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!ids.length) return map;
    try {
      const res = await this.call(creds, 'GET', `/contacts/${ids.join(',')}`);
      const contacts =
        (res.data as { data?: Array<{ id?: string; firstName?: string; lastName?: string }> })
          .data ?? [];
      for (const c of contacts) {
        if (!c.id) continue;
        const display = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.id;
        map.set(c.id, display);
      }
    } catch {
      // degrade to ids
    }
    return map;
  }

  /**
   * Fetch a Wrike comment's body as plain text (GET /comments/{id}?plainText=true —
   * strips the HTML tags Wrike uses for @mentions/links). Best-effort: any failure
   * returns undefined so a comment notification still fires, just without a preview.
   */
  private async getCommentText(
    creds: ProviderCredentials,
    commentId: string,
  ): Promise<string | undefined> {
    try {
      const res = await this.call(creds, 'GET', `/comments/${commentId}`, {
        searchParams: { plainText: 'true' },
      });
      const comment = (res.data as { data?: Array<{ text?: string }> }).data?.[0];
      return comment?.text || undefined;
    } catch {
      return undefined;
    }
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
    return (
      (res.data as { data?: Array<{ id?: string; title?: string; childIds?: string[] }> }).data ??
      []
    );
  }
}
