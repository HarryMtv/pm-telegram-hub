import { beforeAll, describe, expect, it } from 'vitest';

import { hmacSha256 } from '../crypto/index.js';
import type { UnifiedEvent } from '../models/unified.js';
import { findStatusByCategory, shouldEnrich } from './contract-helpers.js';
import { FakeAdapter } from './fake.js';
import { registry, UnknownProviderError } from './registry.js';

/**
 * Conformance: the core drives any provider through the contract generically —
 * no provider name anywhere. Uses a fake adapter (real HMAC path).
 */

const event: UnifiedEvent = {
  provider: 'fake',
  eventType: 'task.status_changed',
  dedupeKey: 'task.status_changed:t1:1',
  taskId: 't1',
  details: { old: 'open', new: 'done' },
  raw: {},
};

beforeAll(() => {
  if (!registry.has('fake')) registry.register(new FakeAdapter({ events: [event] }));
});

describe('adapter registry', () => {
  it('resolves a registered adapter and lists providers', () => {
    expect(registry.has('fake')).toBe(true);
    const adapter = registry.get('fake');
    expect(adapter.id).toBe('fake');
    expect(registry.list()).toContain('fake');
  });

  it('throws UnknownProviderError for unregistered providers', () => {
    expect(() => registry.get('nope')).toThrow(UnknownProviderError);
  });
});

describe('webhook signature verification (raw body HMAC)', () => {
  const secret = 'fake-secret';
  const body = Buffer.from('{"event":"x"}');
  const fake = new FakeAdapter({ secret });

  it('accepts a correctly signed body', () => {
    const sig = hmacSha256(secret, body).toString('hex');
    expect(fake.verifyWebhook(body, { 'x-fake-signature': sig }, secret)).toBe(true);
  });

  it('rejects a wrong secret and a tampered body', () => {
    const sig = hmacSha256(secret, body).toString('hex');
    expect(fake.verifyWebhook(body, { 'x-fake-signature': sig }, 'wrong-secret')).toBe(false);
    expect(fake.verifyWebhook(Buffer.from('{}'), { 'x-fake-signature': sig }, secret)).toBe(false);
    expect(fake.verifyWebhook(body, {}, secret)).toBe(false);
  });
});

describe('capabilities-driven core behavior', () => {
  it('enriches only minimal-payload providers', async () => {
    const minimal = new FakeAdapter({ capabilities: { webhookSetup: 'auto', payload: 'minimal' } });
    const rich = new FakeAdapter({
      capabilities: { webhookSetup: 'admin-required', payload: 'rich' },
    });

    expect(shouldEnrich(minimal)).toBe(true);
    expect(shouldEnrich(rich)).toBe(false);

    // Worker-style decision: enrich when minimal, skip when rich.
    await minimal.enrichEvent(event, {});
    expect(minimal.calls.enrich).toHaveLength(1);
    // rich must not be enriched by the worker
    expect(shouldEnrich(rich)).toBe(false);
  });

  it('enrichEvent fills task name/url/container', async () => {
    const fake = new FakeAdapter({});
    const out = await fake.enrichEvent(event, {});
    expect(out.taskName).toBe('Task t1');
    expect(out.taskUrl).toContain('t1');
    expect(out.containerId).toBe('fake-list');
  });
});

describe('unified status resolution (inline buttons)', () => {
  it('picks the done status by category with no provider knowledge', async () => {
    const fake = new FakeAdapter({});
    const statuses = await fake.getAvailableStatuses({}, 't1');
    const done = findStatusByCategory(statuses, 'done');
    expect(done?.id).toBe('done');

    // Missing category → undefined (workflow forbids it).
    expect(findStatusByCategory(statuses, 'cancelled')?.id).toBe('cancelled');
    expect(
      findStatusByCategory([{ id: 'x', name: 'X', category: 'open' }], 'done'),
    ).toBeUndefined();
  });
});
