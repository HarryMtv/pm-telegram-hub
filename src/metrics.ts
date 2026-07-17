/**
 * Lightweight in-process metrics counters (spec §12: webhook delivery success
 * per provider, latency, remaining rate limit, expired tokens, queue depth).
 * Exposed as Prometheus-ish text at GET /metrics; scrape with Prometheus or read
 * from structured logs. Per-provider labels where relevant.
 */
type Labels = Record<string, string>;

const counters = new Map<string, number>();

function labelKey(labels: Labels): string {
  const entries = Object.entries(labels).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
}

export function inc(name: string, labels: Labels = {}, by = 1): void {
  const key = `${name}${labelKey(labels)}`;
  counters.set(key, (counters.get(key) ?? 0) + by);
}

export function metricsText(): string {
  return (
    [...counters.entries()]
      .map(([key, value]) => `${key} ${value}`)
      .sort()
      .join('\n') + '\n'
  );
}
