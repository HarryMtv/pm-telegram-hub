import type { StatusCategory } from '../models/unified.js';

/**
 * Opaque provider credentials. Shape is known ONLY to the adapter:
 * ClickUp/Wrike → { token }; Jira → { baseUrl, email, apiToken }.
 * The core stores and passes this as an opaque object (encrypted at rest).
 */
export type ProviderCredentials = Record<string, string>;

/** HTTP headers as passed from the webhook route to adapters (case-insensitive lookup). */
export type WebhookHeaders = Record<string, string | string[] | undefined>;

/** Case-insensitive single-value header lookup. */
export function getHeader(headers: WebhookHeaders, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      if (Array.isArray(value)) return value[0];
      return value;
    }
  }
  return undefined;
}

/** What an adapter can / cannot do — the core adapts behavior from this, never from a provider name. */
export interface AdapterCapabilities {
  /** 'auto' = adapter registers the webhook itself; 'admin-required' = Mini App shows admin steps (Jira). */
  webhookSetup: 'auto' | 'admin-required';
  /** Webhook TTL in days; if set, a repeatable refresh job must extend it (Jira dynamic webhooks: 30). */
  webhookLifetimeDays?: number;
  /** 'rich' = payload carries the full task → enrichEvent is a no-op (Jira); 'minimal' = adapter fetches. */
  payload: 'rich' | 'minimal';
}

/** A chat to notify, surfaced to the adapter only when it must not be provider-specific. */
export interface HandshakeResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Unified webhook scope. The core forwards the connection's `scope_id` as
 * `workspaceId`; the adapter translates it to the provider's webhook endpoint
 * (ClickUp team, Wrike account/space/folder, Jira site).
 */
export interface WebhookScope {
  level: 'workspace' | 'container';
  workspaceId: string; // = connection.scope_id
  containerId?: string;
}

/** Result of registering a webhook. `secret` is PLAINTEXT — the core encrypts it before storing. */
export interface WebhookRef {
  providerWebhookId: string;
  secret: string;
  scope?: Record<string, unknown>;
  expiresAt?: Date | null;
}

/** Result of verifying credentials; `scopeId` becomes the connection's scope_id. */
export interface AccountInfo {
  scopeId: string;
  externalId?: string;
  displayName?: string;
  email?: string;
}

export interface CreateTaskInput {
  name: string;
  /** Unified container id (ClickUp list, Wrike folder, Jira project). */
  containerId: string;
  description?: string;
  assignees?: string[];
  dueDate?: string; // ISO date
  statusId?: string;
}

export interface TaskPatch {
  name?: string;
  description?: string;
  dueDate?: string | null;
  addAssignees?: string[];
  removeAssignees?: string[];
}

export interface TaskRef {
  id: string;
  url: string;
}

/** Options for addComment. `mentions` are stable provider user ids to @mention (ping). */
export interface CommentOptions {
  mentions?: string[];
}

/** Credential form field — drives Mini App rendering and /connect routing. */
export interface CredentialField {
  key: string;
  label: string;
  type: 'token' | 'text' | 'url' | 'password';
  required?: boolean;
  placeholder?: string;
}

export interface RateLimitConfig {
  /** 'fixed' = steady token-bucket at `rpm`; 'dynamic' = honor Retry-After only. */
  mode: 'fixed' | 'dynamic';
  rpm?: number;
  respectRetryAfter: boolean;
}

/** The connection data an adapter needs for rate-limit decisions. */
export interface Connection {
  id: string;
  provider: string;
  scopeId: string;
  credentials: ProviderCredentials;
}

export type { StatusCategory };
