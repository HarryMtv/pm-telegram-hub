/// <reference types="vite/client" />

import { retrieveRawInitData } from '@telegram-apps/sdk-react';

const API = import.meta.env.VITE_API_URL ?? '';
const AUTH_PATH = '/api/auth/init-data';

let token: string | null = localStorage.getItem('token');

export function getToken(): string | null {
  return token;
}

export function setToken(value: string | null): void {
  token = value;
  if (value) localStorage.setItem('token', value);
  else localStorage.removeItem('token');
}

// Notified when the session is unrecoverable (re-auth failed) so the UI can
// fall back to the sign-in gate instead of looping on 401s.
type AuthLostHandler = () => void;
const authLostHandlers = new Set<AuthLostHandler>();
export function onAuthLost(cb: AuthLostHandler): () => void {
  authLostHandlers.add(cb);
  return () => {
    authLostHandlers.delete(cb);
  };
}

/** Exchange the current Telegram initData for a fresh app JWT and store it. */
async function runAuthenticate(): Promise<boolean> {
  let initDataRaw: string | undefined;
  try {
    initDataRaw = retrieveRawInitData();
  } catch {
    initDataRaw = undefined;
  }
  if (!initDataRaw) {
    setToken(null);
    return false;
  }
  const res = await fetch(`${API}${AUTH_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: initDataRaw }),
  });
  if (!res.ok) {
    setToken(null);
    return false;
  }
  const { token: fresh } = (await res.json()) as { token: string };
  setToken(fresh);
  return true;
}

// Dedupe concurrent re-auths: parallel 401s (e.g. Inbox firing several queries)
// share a single initData→token exchange instead of racing.
let pendingAuth: Promise<boolean> | null = null;
export function authenticate(): Promise<boolean> {
  if (!pendingAuth) {
    pendingAuth = runAuthenticate().finally(() => {
      pendingAuth = null;
    });
  }
  return pendingAuth;
}

function request(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
}

/**
 * Authenticated JSON fetch against the Integration Service. On a 401 it
 * transparently re-authenticates with a fresh initData and retries once; if that
 * still fails, the stored token is cleared and auth-lost listeners fire so the
 * app shows the sign-in gate rather than looping on 401s.
 */
export async function api(path: string, init: RequestInit = {}): Promise<any> {
  let res = await request(path, init);

  if (res.status === 401 && path !== AUTH_PATH) {
    if (await authenticate()) {
      res = await request(path, init);
    }
    if (res.status === 401) {
      setToken(null);
      for (const cb of authLostHandlers) cb();
    }
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${path} → ${res.status}: ${body}`);
  }
  return res.json();
}
