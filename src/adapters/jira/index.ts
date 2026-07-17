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
  adfToText,
  mapJiraStatusCategory,
  mapJiraTransition,
  parseJiraEvents,
  textToAdf,
  type JiraTransition,
  type JiraWebhookPayload,
} from './mapping.js';

/**
 * Jira Cloud adapter (spec §4.3). This provider dictated the interface's design:
 * opaque credentials, `getAvailableStatuses(taskId)` (transitions), `capabilities()`
 * (admin webhooks + rich payload), and `parseEvents(headers)` (delivery id).
 */
export class JiraAdapter implements ProviderAdapter {
  readonly id = 'jira';

  capabilities(): AdapterCapabilities {
    // Admin webhooks (created in Jira UI) never expire; dynamic (OAuth) webhooks
    // are 30-day and would need a refresh job (Phase 3+ enhancement).
    return { webhookSetup: 'admin-required', payload: 'rich' };
  }

  credentialFields(): CredentialField[] {
    return [
      { key: 'baseUrl', label: 'Jira site URL', type: 'url', required: true, placeholder: 'https://yourteam.atlassian.net' },
      { key: 'email', label: 'Email', type: 'text', required: true },
      { key: 'apiToken', label: 'API token', type: 'password', required: true },
    ];
  }

  // No handshake for Jira admin webhooks.

  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean {
    // X-Hub-Signature (WebSub): "sha256=<hex>"
    const sig = getHeader(headers, 'x-hub-signature');
    if (!sig?.startsWith('sha256=')) return false;
    return verifyHexHmac(secret, rawBody, sig.slice('sha256='.length));
  }

  extractWebhookId(payload: unknown): string | undefined {
    return (payload as JiraWebhookPayload | undefined)?.webhook_id;
  }

  parseEvents(payload: unknown, headers: WebhookHeaders): UnifiedEvent[] {
    return parseJiraEvents((payload as JiraWebhookPayload) ?? {}, headers);
  }

  /** Rich payload → no fetch. Return unchanged. */
  async enrichEvent(event: UnifiedEvent, _creds: ProviderCredentials): Promise<UnifiedEvent> {
    return event;
  }

  // Jira webhooks are admin-created; no programmatic registration in Phase 3 MVP.
  async registerWebhook(_creds: ProviderCredentials, scope: WebhookScope): Promise<WebhookRef> {
    // The Mini App generates a secret and shows the admin the URL + events to enter.
    throw new Error(
      `Jira uses admin webhooks (${scope.workspaceId}); the Mini App shows the admin setup steps.`,
    );
  }
  async deleteWebhook(): Promise<void> {
    // No programmatic deletion for admin webhooks.
  }

  async verifyCredentials(creds: ProviderCredentials): Promise<AccountInfo> {
    const res = await this.call(creds, 'GET', '/rest/api/3/myself');
    const myself = res.data as { accountId?: string; displayName?: string; emailAddress?: string };
    return {
      scopeId: this.baseUrl(creds),
      externalId: myself.accountId,
      displayName: myself.displayName,
      email: myself.emailAddress,
    };
  }

  async createTask(creds: ProviderCredentials, input: CreateTaskInput): Promise<TaskRef> {
    const fields: Record<string, unknown> = {
      project: { id: input.containerId },
      summary: input.name,
    };
    if (input.description) fields.description = textToAdf(input.description);
    if (input.dueDate) fields.duedate = input.dueDate;
    if (input.assignees?.[0]) fields.assignee = { accountId: input.assignees[0] };
    const res = await this.call(creds, 'POST', '/rest/api/3/issue', { body: JSON.stringify({ fields }) });
    const issue = res.data as { id?: string; key?: string };
    const key = issue.key;
    if (!key) throw new Error('Jira createTask: no key returned');
    return { id: key, url: `${this.baseUrl(creds)}/browse/${key}` };
  }

  async updateTask(creds: ProviderCredentials, taskId: string, patch: TaskPatch): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (patch.name !== undefined) fields.summary = patch.name;
    if (patch.description !== undefined) fields.description = textToAdf(patch.description);
    if (patch.dueDate !== undefined) fields.duedate = patch.dueDate === null ? null : patch.dueDate;
    if (patch.addAssignees?.[0]) fields.assignee = { accountId: patch.addAssignees[0] };
    if (patch.removeAssignees?.length) fields.assignee = null;
    await this.call(creds, 'PUT', `/rest/api/3/issue/${taskId}`, { body: JSON.stringify({ fields }) });
  }

  /** Status changes are transitions: get them per task, then POST the transition id. */
  async getAvailableStatuses(creds: ProviderCredentials, taskId: string): Promise<StatusDef[]> {
    const res = await this.call(creds, 'GET', `/rest/api/3/issue/${taskId}/transitions`);
    const transitions = (res.data as { transitions?: JiraTransition[] }).transitions ?? [];
    return transitions.map(mapJiraTransition).filter((s): s is StatusDef => s !== null);
  }

  async setStatus(creds: ProviderCredentials, taskId: string, statusId: string): Promise<void> {
    await this.call(creds, 'POST', `/rest/api/3/issue/${taskId}/transitions`, {
      body: JSON.stringify({ transition: { id: statusId } }),
    });
  }

  async addComment(creds: ProviderCredentials, taskId: string, text: string): Promise<void> {
    await this.call(creds, 'POST', `/rest/api/3/issue/${taskId}/comment`, {
      body: JSON.stringify({ body: textToAdf(text) }),
    });
  }

  async getTask(creds: ProviderCredentials, taskId: string): Promise<UnifiedTask> {
    const res = await this.call(creds, 'GET', `/rest/api/3/issue/${taskId}`);
    const issue = res.data as {
      key: string;
      fields?: {
        summary?: string;
        description?: unknown;
        status?: { name?: string; statusCategory?: { key?: string } };
        assignee?: { accountId?: string; displayName?: string } | null;
        duedate?: string;
        project?: { id?: string };
      };
    };
    const fields = issue.fields ?? {};
    const statusCat = fields.status?.statusCategory?.key;
    return {
      provider: this.id,
      id: issue.key,
      name: fields.summary ?? issue.key,
      description: fields.description ? adfToText(fields.description) : undefined,
      status: {
        id: fields.status?.name ?? '',
        name: fields.status?.name ?? '',
        category: mapJiraStatusCategory(statusCat),
      },
      assignees: fields.assignee?.accountId ? [fields.assignee.accountId] : [],
      dueDate: fields.duedate,
      url: `${this.baseUrl(creds)}/browse/${issue.key}`,
      containerId: fields.project?.id ?? '',
    };
  }

  async listContainers(creds: ProviderCredentials): Promise<Container[]> {
    const site = this.baseUrl(creds);
    const res = await this.call(creds, 'GET', '/rest/api/3/project/search');
    const projects = (res.data as { values?: Array<{ id?: string; key?: string; name?: string }> }).values ?? [];
    return [
      { id: site, name: 'Site', kind: 'root', canContainTasks: false },
      ...projects.map((p) => ({
        id: String(p.id ?? p.key ?? ''),
        name: p.name ?? p.key ?? String(p.id ?? ''),
        kind: 'tasklist' as const,
        canContainTasks: true,
        parentId: site,
      })),
    ];
  }

  rateLimit(_connection: Connection): RateLimitConfig {
    // Jira has no fixed rpm — dynamic, honor Retry-After on 429.
    return { mode: 'dynamic', respectRetryAfter: true };
  }

  // ── API helpers ─────────────────────────────────────────────────────────────

  private baseUrl(creds: ProviderCredentials): string {
    return String(creds.baseUrl ?? '').replace(/\/+$/, '');
  }

  private authHeaders(creds: ProviderCredentials): Record<string, string> {
    const raw = `${creds.email ?? ''}:${creds.apiToken ?? ''}`;
    const basic = Buffer.from(raw).toString('base64');
    return { Authorization: `Basic ${basic}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  }

  private call(
    creds: ProviderCredentials,
    method: string,
    path: string,
    opts: { body?: string } = {},
  ) {
    return providerFetch(`${this.baseUrl(creds)}${path}`, {
      method,
      headers: this.authHeaders(creds),
      body: opts.body,
    });
  }
}
