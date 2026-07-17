/// <reference types="vite/client" />

const API = import.meta.env.VITE_API_URL ?? '';

let token: string | null = localStorage.getItem('token');

export function getToken(): string | null {
  return token;
}

export function setToken(value: string | null): void {
  token = value;
  if (value) localStorage.setItem('token', value);
  else localStorage.removeItem('token');
}

/** Authenticated JSON fetch against the Integration Service. */
export async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${path} → ${res.status}: ${body}`);
  }
  return res.json();
}
