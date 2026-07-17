import IORedis from 'ioredis';

import { config } from '../config/index.js';

let _redis: IORedis | null = null;

/** A Redis connection for ad-hoc use (health pings). Not shared with BullMQ. */
export function getRedis(): IORedis {
  if (!_redis) _redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  return _redis;
}

/**
 * Parsed Redis options for BullMQ. BullMQ bundles its own copy of ioredis, so we
 * pass a plain options object (URL→host/port/db/password) rather than our ioredis
 * instance to avoid a nominal type clash. BullMQ forces maxRetriesPerRequest:null.
 */
export function bullmqConnection(): {
  host: string;
  port: number;
  password?: string;
  db: number;
  username?: string;
} {
  const u = new URL(config.redisUrl);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    username: u.username ? decodeURIComponent(u.username) : undefined,
  };
}
