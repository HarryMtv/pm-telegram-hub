import { ClickUpAdapter } from './clickup/index.js';
import { JiraAdapter } from './jira/index.js';
import { registry } from './registry.js';
import { WrikeAdapter } from './wrike/index.js';

export { registry } from './registry.js';

let initialized = false;

/** Register all available adapters (ClickUp + Wrike in Phase 1, Jira in Phase 3). Idempotent. */
export function registerAdapters(): void {
  if (initialized) return;
  registry.register(new ClickUpAdapter());
  registry.register(new WrikeAdapter());
  registry.register(new JiraAdapter());
  initialized = true;
}
