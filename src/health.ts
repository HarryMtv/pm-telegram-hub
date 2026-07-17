export interface HealthCheck {
  name: string;
  check: () => Promise<boolean> | boolean;
}

/** Race a promise against a timeout — resolves null if it doesn't settle in time.
 * Prevents health probes from hanging when a dependency is unreachable (e.g.
 * ioredis retries a dead Redis forever). */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export interface HealthReport {
  ok: boolean;
  checks: Record<string, boolean>;
  timestamp: string;
}

/**
 * Central readiness/liveness probes. Modules that own external dependencies
 * (Redis/BullMQ, Supabase) register a check; `GET /health` aggregates them.
 *
 * Per the deployment spec, health must reflect queue connectivity — so the
 * queue module registers a `queue` check that pings Redis.
 */
class HealthService {
  private checks = new Map<string, HealthCheck>();

  register(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }

  async report(): Promise<HealthReport> {
    const checks: Record<string, boolean> = {};
    let ok = true;
    for (const [name, check] of this.checks) {
      try {
        checks[name] = await Promise.resolve(check.check());
      } catch {
        checks[name] = false;
      }
      if (!checks[name]) ok = false;
    }
    return { ok, checks, timestamp: new Date().toISOString() };
  }
}

export const healthService = new HealthService();
