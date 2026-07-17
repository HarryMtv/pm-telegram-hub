import type { ProviderAdapter } from './provider-adapter.js';

export class UnknownProviderError extends Error {
  constructor(provider: string) {
    super(`unknown provider: ${provider}`);
    this.name = 'UnknownProviderError';
  }
}

/**
 * Adapter registry. A new provider = one adapter file + one `register()` call.
 * The core resolves adapters exclusively through `get(provider)` from the
 * webhook path's `:provider` param and from connection rows.
 */
class AdapterRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`adapter already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(provider: string): ProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new UnknownProviderError(provider);
    return adapter;
  }

  has(provider: string): boolean {
    return this.adapters.has(provider);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}

export const registry = new AdapterRegistry();
