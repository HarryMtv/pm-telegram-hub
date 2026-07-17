import type { Container, StatusDef, UnifiedEvent, UnifiedTask } from '../models/unified.js';
import type {
  AccountInfo,
  AdapterCapabilities,
  CommentOptions,
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
} from './types.js';

/**
 * The single contract every provider implements (spec §2.1). Designed for the
 * intersection of ClickUp, Wrike and Jira — a third provider must fit without
 * core changes.
 *
 * The core calls only these methods and reads only unified models. The adapter
 * owns: credential shape, webhook lifecycle, event parsing/expansion, task
 * actions, hierarchy mapping, status categories and rate limiting.
 */
export interface ProviderAdapter {
  /** Stable provider id: 'clickup' | 'wrike' | 'jira' | ... */
  readonly id: string;

  /** Descriptor the core adapts behavior from (no provider name checks). */
  capabilities(): AdapterCapabilities;

  /**
   * Credential form schema. The Mini App renders these fields; `/connect` accepts
   * providers with a single `token` field in chat, complex providers (Jira) go via
   * the Mini App. Keeps the core provider-name-free.
   */
  credentialFields(): CredentialField[];

  // ── Webhooks ──────────────────────────────────────────────────────────────

  /**
   * Some providers (Wrike) require a handshake at registration: returns a
   * non-null response that the endpoint replies with immediately (no job
   * enqueued). `null` for normal notifications. Wrike detects the
   * (empty-body) verification request via `rawBody` and echoes `X-Hook-Secret`.
   */
  handleHandshake?(headers: WebhookHeaders, rawBody?: Buffer): HandshakeResponse | null;

  /**
   * Verify the request signature. `rawBody` is the original bytes (HMAC is over
   * raw bytes, never re-serialized JSON).
   */
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean;

  /**
   * Pull the provider's webhook id from the (untrusted) payload/headers so the
   * endpoint can look up the signing secret before verification (spec §5 step 4).
   * The id itself is not secret; authenticity is proven by the signature.
   */
  extractWebhookId(payload: unknown, headers: WebhookHeaders): string | undefined;

  /**
   * ALWAYS returns an array. Wrike batches several events per request; Jira
   * expands a single changelog into several events. `headers` are needed for
   * delivery ids (Jira X-Atlassian-Webhook-Identifier).
   */
  parseEvents(payload: unknown, headers: WebhookHeaders): UnifiedEvent[];

  /**
   * Fetch missing task data for 'minimal'-payload providers; a no-op for 'rich'
   * (Jira). Runs through the connection owner's rate limiter.
   */
  enrichEvent(event: UnifiedEvent, creds: ProviderCredentials): Promise<UnifiedEvent>;

  /** Register the webhook; the adapter encapsulates the secret source
   * (ClickUp: provider-issued; Wrike/Jira: system-generated). */
  registerWebhook(creds: ProviderCredentials, scope: WebhookScope): Promise<WebhookRef>;
  refreshWebhook?(creds: ProviderCredentials, ref: WebhookRef): Promise<void>;
  deleteWebhook(creds: ProviderCredentials, providerWebhookId: string): Promise<void>;

  // ── Task actions (bot / Mini App) ──────────────────────────────────────────

  verifyCredentials(creds: ProviderCredentials): Promise<AccountInfo>;
  createTask(creds: ProviderCredentials, input: CreateTaskInput): Promise<TaskRef>;
  updateTask(creds: ProviderCredentials, taskId: string, patch: TaskPatch): Promise<void>;
  setStatus(creds: ProviderCredentials, taskId: string, statusId: string): Promise<void>;
  addComment(
    creds: ProviderCredentials,
    taskId: string,
    text: string,
    opts?: CommentOptions,
  ): Promise<void>;
  getTask(creds: ProviderCredentials, taskId: string): Promise<UnifiedTask>;

  // ── Navigation (unified hierarchy) ─────────────────────────────────────────

  listContainers(creds: ProviderCredentials, parentId?: string): Promise<Container[]>;

  /** Statuses per task (Jira transitions depend on current state), mapped to categories. */
  getAvailableStatuses(creds: ProviderCredentials, taskId: string): Promise<StatusDef[]>;

  // ── Rate limiting ──────────────────────────────────────────────────────────

  /** Fixed rpm or Retry-After-driven; provider calls go through this limiter. */
  rateLimit(connection: Connection): RateLimitConfig;
}
