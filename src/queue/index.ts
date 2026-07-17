import { Queue } from 'bullmq';

import { bullmqConnection } from './connection.js';

export const WEBHOOK_QUEUE_NAME = 'webhooks';

export interface WebhookJobData {
  provider: string;
  connectionId: string;
  payload: unknown;
  /** Flattened request headers (first value per name) — needed for delivery ids. */
  headers: Record<string, string>;
}

let _queue: Queue | null = null;

export function getQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(WEBHOOK_QUEUE_NAME, {
      connection: bullmqConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        // Jobs that exhaust retries remain in the `failed` set — the DLQ.
        removeOnFail: { age: 7 * 24 * 3600, count: 10_000 },
        removeOnComplete: { age: 24 * 3600, count: 5_000 },
      },
    });
  }
  return _queue;
}
