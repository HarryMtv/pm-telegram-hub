import { Job, Worker } from 'bullmq';

import { registerAdapters, registry } from '../adapters/index.js';
import { shouldEnrich } from '../adapters/contract-helpers.js';
import { withConnection } from '../adapters/context.js';
import { rateLimiters } from '../adapters/rate-limiter.js';
import { decryptJson } from '../crypto/index.js';
import { getActiveConnectionById } from '../db/connections.js';
import {
  setNotificationMessageId,
  tryInsertNotification,
} from '../db/notification-log.js';
import { listActiveSubscriptionsForConnection } from '../db/subscriptions.js';
import { logger } from '../logger.js';
import { inc } from '../metrics.js';
import type { UnifiedEvent } from '../models/unified.js';
import { deliverEvent } from '../notifier/index.js';
import { bullmqConnection } from './connection.js';
import { WEBHOOK_QUEUE_NAME, type WebhookJobData } from './index.js';

/** Apply unified subscription filters: container list and "assigned to me". */
export function matchesFilters(filters: Record<string, unknown>, event: UnifiedEvent): boolean {
  const containers = filters.containers;
  if (Array.isArray(containers) && containers.length) {
    if (!event.containerId || !containers.includes(event.containerId)) return false;
  }
  // "Assigned to me": the adapter populates details.assigneeIds (stable provider
  // user ids); the subscription stores the connection owner's id (`/subscribe me`).
  // The comparison is provider-agnostic — the core never names a provider.
  const assignee = filters.assignee;
  if (typeof assignee === 'string' && assignee !== '') {
    const ids = event.details.assigneeIds;
    if (!Array.isArray(ids) || !ids.includes(assignee)) return false;
  }
  return true;
}

/** Swappable dependencies for the fan-out step (testable in isolation). */
export interface FanOutDeps {
  tryInsert: (subId: string, dedupeKey: string, eventType: string) => Promise<boolean>;
  deliver: (chatId: number, event: UnifiedEvent, opts: { showActions: boolean; connectionId: string }) => Promise<number>;
  record: (subId: string, dedupeKey: string, messageId: number) => Promise<void>;
}

/**
 * Fan an enriched event out to matching subscriptions: event-type filter,
 * container filter, idempotent insert (skip duplicates), deliver, record.
 * Spec §5 step 8c–8e.
 */
export async function fanOut(
  enriched: UnifiedEvent,
  subscriptions: Array<{ id: string; connection_id: string; telegram_chat_id: string; event_types: string[]; filters: Record<string, unknown> }>,
  deps: FanOutDeps,
  opts: { selfActorId?: string } = {},
): Promise<{ delivered: number; deduped: number; selfSuppressed: number }> {
  let delivered = 0;
  let deduped = 0;
  let selfSuppressed = 0;
  for (const sub of subscriptions) {
    if (!sub.event_types.includes(enriched.eventType)) continue;
    if (!matchesFilters(sub.filters, enriched)) continue;

    // Self-echo suppression (on by default): the bot already acknowledged actions
    // the owner took through it, and the user just performed the rest themselves —
    // so skip events whose actor is the connection owner.
    if (opts.selfActorId && enriched.actorId && enriched.actorId === opts.selfActorId) {
      selfSuppressed++;
      continue;
    }

    const inserted = await deps.tryInsert(sub.id, enriched.dedupeKey, enriched.eventType);
    if (!inserted) {
      deduped++; // duplicate → idempotent skip
      continue;
    }

    const chatId = Number(sub.telegram_chat_id);
    const messageId = await deps.deliver(chatId, enriched, {
      showActions: true,
      connectionId: sub.connection_id,
    });
    await deps.record(sub.id, enriched.dedupeKey, messageId);
    delivered++;
  }
  return { delivered, deduped, selfSuppressed };
}

async function processJob(job: Job<WebhookJobData>): Promise<void> {
  const { provider, connectionId, payload, headers } = job.data;
  const adapter = registry.get(provider);

  const conn = await getActiveConnectionById(connectionId);
  if (!conn) {
    logger.warn({ connectionId }, 'webhook for missing/inactive connection — dropping');
    return;
  }

  const creds = decryptJson<Record<string, string>>(conn.credentials);
  const connection = { id: conn.id, provider: conn.provider, scopeId: conn.scope_id, credentials: creds };
  const limiter = rateLimiters.forConnection(connectionId, adapter.rateLimit(connection));

  const subscriptions = await listActiveSubscriptionsForConnection(connectionId);
  if (subscriptions.length === 0) {
    // Events ARE arriving (ClickUp delivered, signature verified) but nothing is
    // subscribed — without this log the drop is completely silent.
    logger.info({ connectionId, provider }, 'webhook processed, no active subscriptions — run /subscribe');
    return;
  }

  const events = adapter.parseEvents(payload, headers);
  inc('events_parsed', { provider }, events.length);

  await withConnection({ connection, limiter }, async () => {
    for (const event of events) {
      const enriched = shouldEnrich(adapter) ? await adapter.enrichEvent(event, creds) : event;
      const result = await fanOut(
        enriched,
        subscriptions,
        {
          tryInsert: tryInsertNotification,
          deliver: deliverEvent,
          record: setNotificationMessageId,
        },
        { selfActorId: conn.account?.externalId },
      );
      inc('notifications_delivered', { provider }, result.delivered);
      inc('notifications_deduped', { provider }, result.deduped);
      inc('notifications_self_suppressed', { provider }, result.selfSuppressed);
    }
  });
}

let _worker: Worker | null = null;

export function startWorker(): Worker {
  if (_worker) return _worker;
  registerAdapters();
  _worker = new Worker<WebhookJobData>(WEBHOOK_QUEUE_NAME, processJob, {
    connection: bullmqConnection(),
    concurrency: 8,
  });
  _worker.on('failed', (job, err) => {
    inc('jobs_failed', { provider: job?.data.provider ?? 'unknown' });
    logger.error({ jobId: job?.id, err: err.message }, 'webhook job failed (→ DLQ after retries)');
  });
  logger.info('webhook worker started');
  return _worker;
}

export async function stopWorker(): Promise<void> {
  if (_worker) await _worker.close();
}
