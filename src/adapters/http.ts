import { currentLimiter } from './context.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Thrown for any non-2xx (after exhausting 429 retries). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  searchParams?: Record<string, string>;
}

export interface FetchResult {
  status: number;
  data: unknown;
  headers: Headers;
}

/**
 * Shared provider HTTP client. Acquires a token from the current connection's
 * limiter (if any) before each request, and — per spec §4 — honors `Retry-After`
 * on 429 with bounded retries. Throws `HttpError` on terminal non-2xx.
 */
export async function providerFetch(
  url: string,
  opts: FetchOptions = {},
  retries = 3,
): Promise<FetchResult> {
  const limiter = currentLimiter();
  const fullUrl = opts.searchParams ? withQuery(url, opts.searchParams) : url;
  const method = opts.method ?? 'GET';

  for (let attempt = 0; ; attempt++) {
    if (limiter) await limiter.take();

    const res = await fetch(fullUrl, {
      method,
      headers: opts.headers,
      body: opts.body ?? undefined,
    });
    const text = await res.text();

    if (res.status === 429 && attempt < retries) {
      const waitMs = parseRetryAfter(res.headers.get('retry-after'));
      if (waitMs > 0) await sleep(waitMs);
      continue;
    }
    if (res.status >= 400) {
      throw new HttpError(res.status, text, `${method} ${url} → ${res.status}`);
    }
    return { status: res.status, data: text ? safeJson(text) : undefined, headers: res.headers };
  }
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return Math.min(Math.max(seconds * 1000, 0), 60_000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 60_000);
  return 0;
}

function withQuery(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
