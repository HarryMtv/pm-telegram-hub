import type { StatusCategory, StatusDef } from '../models/unified.js';
import type { ProviderAdapter } from './provider-adapter.js';

/**
 * Whether the worker must call `enrichEvent`. 'minimal' providers need a task
 * fetch; 'rich' providers (Jira) carry the full task, so enrich is a no-op.
 * This is the capabilities-driven branch — no provider name in sight.
 */
export function shouldEnrich(adapter: ProviderAdapter): boolean {
  return adapter.capabilities().payload === 'minimal';
}

/**
 * Find a status for a unified category. Used by inline buttons (e.g. "Done" →
 * category 'done') and `/status`. Returns undefined if no status of that
 * category is available for the task (e.g. workflow forbids it).
 */
export function findStatusByCategory(
  statuses: StatusDef[],
  category: StatusCategory,
): StatusDef | undefined {
  return statuses.find((s) => s.category === category);
}
