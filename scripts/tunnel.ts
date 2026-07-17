/**
 * Manage the ephemeral cloudflared tunnel + keep ClickUp pointed at it.
 *
 *   pnpm tunnel                                 restart tunnel, set APP_URL, re-register webhook
 *   pnpm tsx scripts/tunnel.ts https://<url>    re-register webhook for an ALREADY-running tunnel
 *
 * `trycloudflare` quick tunnels: new url each start, some never route, and
 * ClickUp suspends a webhook whose endpoint stops responding. So a restart must
 * bring up a REACHABLE tunnel, rewrite APP_URL, and re-register the webhook — or
 * notifications silently stop.
 *
 * Notes that took iteration to learn:
 *  - `--protocol http2` (QUIC sometimes never routes from this network).
 *  - settle ~8s after the url appears (edge routing lags publication).
 *  - `nohup … &` so cloudflared survives this script exiting.
 *  - few attempts; rapid retries look like abuse and route worse, not better.
 */
import 'dotenv/config';

import { exec } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

import { CLICKUP_WEBHOOK_EVENTS } from '../src/adapters/clickup/mapping.js';
import { decryptJson, encrypt, hmacSha256 } from '../src/crypto/index.js';
import { getSupabase } from '../src/db/client.js';

const BASE = 'https://api.clickup.com/api/v2';
const TUNNEL_LOG = '/tmp/pmhub-tunnel.log';
const ENV_FILE = '.env';
const PORT = process.env.PORT || '3001';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const sh = (cmd: string): Promise<void> => new Promise((resolve) => exec(cmd, () => resolve()));

async function waitForUrl(timeoutMs = 30_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const m = (await readFile(TUNNEL_LOG, 'utf8')).match(
        /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
      );
      if (m) return m[0] as string;
    } catch {
      // log not written yet
    }
    await sleep(500);
  }
  throw new Error('cloudflared did not publish a url in time');
}

async function waitForReachable(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(8000) });
      if (r.ok && (await r.text()).includes('"ok":true')) return;
    } catch {
      // not routable yet
    }
    await sleep(1500);
  }
  throw new Error(`${url} did not become reachable in time`);
}

async function bringUpReachableTunnel(attempts = 2): Promise<string> {
  for (let i = 1; i <= attempts; i++) {
    console.log(`attempt ${i}/${attempts}: restarting cloudflared (http2)…`);
    await sh("pkill -f 'cloudflared tunnel' 2>/dev/null");
    await sleep(1500);
    await sh(
      `nohup cloudflared tunnel --protocol http2 --url http://localhost:${PORT} > ${TUNNEL_LOG} 2>&1 &`,
    );
    let url: string;
    try {
      url = await waitForUrl();
    } catch (e) {
      console.log(`  ${(e as Error).message}`);
      continue;
    }
    console.log(`  url: ${url}`);
    console.log('  settling 8s (edge routing lags url publication)…');
    await sleep(8000);
    try {
      await waitForReachable(url);
      return url;
    } catch {
      console.log('  still not routable — trying a fresh tunnel');
    }
  }
  throw new Error(
    `no reachable tunnel after ${attempts} attempts — trycloudflare can be flaky; run again or pass an existing url`,
  );
}

async function setEnvAppUrl(url: string): Promise<void> {
  const content = await readFile(ENV_FILE, 'utf8');
  const next = /^APP_URL=.*$/m.test(content)
    ? content.replace(/^APP_URL=.*$/m, `APP_URL=${url}`)
    : `${content.trimEnd()}\nAPP_URL=${url}\n`;
  await writeFile(ENV_FILE, next);
}

async function reRegisterClickUpWebhook(newUrl: string): Promise<void> {
  const sb = getSupabase();
  const { data: conn } = await sb
    .from('provider_connections')
    .select()
    .eq('provider', 'clickup')
    .maybeSingle();
  if (!conn) throw new Error('no clickup connection — run /connect clickup <token> first');
  const token = decryptJson<Record<string, string>>(conn.credentials).token;
  if (!token) throw new Error('connection has no token');
  const h = { Authorization: token, 'Content-Type': 'application/json' };

  const { teams } = (await (await fetch(`${BASE}/team`, { headers: h })).json()) as {
    teams?: Array<{ id: string | number }>;
  };
  const teamId = teams?.[0]?.id;
  if (!teamId) throw new Error('token has no teams');

  const { webhooks } = (await (
    await fetch(`${BASE}/team/${teamId}/webhook`, { headers: h })
  ).json()) as {
    webhooks?: Array<{ id: string }>;
  };
  for (const w of webhooks ?? []) {
    await fetch(`${BASE}/webhook/${w.id}`, { method: 'DELETE', headers: h });
  }

  const endpoint = `${newUrl.replace(/\/+$/, '')}/webhooks/clickup`;
  const res = await fetch(`${BASE}/team/${teamId}/webhook`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ endpoint, events: CLICKUP_WEBHOOK_EVENTS }),
  });
  const body = (await res.json()) as {
    webhook?: { id?: string; secret?: string };
    id?: string;
    secret?: string;
    err?: string;
    ECODE?: string;
  };
  const wh = body.webhook ?? { id: body.id, secret: body.secret };
  if (!wh.id || !wh.secret)
    throw new Error(`webhook register failed: ${JSON.stringify(body).slice(0, 200)}`);

  const secretEnc = encrypt(wh.secret);
  const scope = { teamId: String(teamId) };
  const { data: old } = await sb
    .from('webhooks')
    .select()
    .eq('connection_id', conn.id)
    .maybeSingle();
  if (old) {
    await sb
      .from('webhooks')
      .update({ provider_webhook_id: wh.id, secret: secretEnc, scope })
      .eq('id', old.id);
  } else {
    await sb.from('webhooks').insert({
      connection_id: conn.id,
      provider: 'clickup',
      provider_webhook_id: wh.id,
      secret: secretEnc,
      scope,
    });
  }
  console.log(`  webhook ${wh.id} → ${endpoint}`);
}

/**
 * Re-register the Wrike webhook at the fresh tunnel URL. The signing secret is
 * deterministic (derived from ENCRYPTION_KEY) — identical to what the adapter
 * uses in registerWebhook/handleHandshake — so the Secure-Webhook handshake the
 * live server performs during this POST succeeds without any DB state. Stale
 * webhooks (pointing at the previous, now-dead tunnel) are deleted first.
 */
async function reRegisterWrikeWebhook(newUrl: string): Promise<void> {
  const sb = getSupabase();
  const { data: conn } = await sb
    .from('provider_connections')
    .select()
    .eq('provider', 'wrike')
    .maybeSingle();
  if (!conn) {
    console.log('  no wrike connection — skipping');
    return;
  }
  const token = decryptJson<Record<string, string>>(conn.credentials).token;
  if (!token) throw new Error('wrike connection has no token');
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const BASE_W = 'https://www.wrike.com/api/v4';

  const existing = (await (await fetch(`${BASE_W}/webhooks`, { headers: h })).json()) as {
    data?: Array<{ id: string }>;
  };
  for (const w of existing.data ?? []) {
    await fetch(`${BASE_W}/webhooks/${w.id}`, { method: 'DELETE', headers: h });
  }

  const secret = hmacSha256(process.env.ENCRYPTION_KEY ?? '', 'wrike-webhook-signing').toString(
    'hex',
  );
  const hookUrl = `${newUrl.replace(/\/+$/, '')}/webhooks/wrike`;
  const res = await fetch(`${BASE_W}/webhooks`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ hookUrl, secret }),
  });
  const body = (await res.json()) as { data?: Array<{ id?: string }>; errorDescription?: string };
  const id = body.data?.[0]?.id;
  if (!id) throw new Error(`wrike webhook register failed: ${JSON.stringify(body).slice(0, 200)}`);

  const secretEnc = encrypt(secret);
  const scope = { level: 'Account' };
  const { data: old } = await sb
    .from('webhooks')
    .select()
    .eq('connection_id', conn.id)
    .maybeSingle();
  if (old) {
    await sb
      .from('webhooks')
      .update({ provider_webhook_id: id, secret: secretEnc, scope })
      .eq('id', old.id);
  } else {
    await sb.from('webhooks').insert({
      connection_id: conn.id,
      provider: 'wrike',
      provider_webhook_id: id,
      secret: secretEnc,
      scope,
    });
  }
  console.log(`  wrike webhook ${id} → ${hookUrl}`);
}

async function main(): Promise<void> {
  const reuseUrl = process.argv[2];
  let url: string;
  if (reuseUrl) {
    console.log(`register-only: reusing ${reuseUrl}`);
    await waitForReachable(reuseUrl);
    url = reuseUrl;
  } else {
    url = await bringUpReachableTunnel();
    console.log(`reachable ✓  ${url}`);
  }

  await setEnvAppUrl(url);
  console.log('.env APP_URL updated');

  console.log('re-registering ClickUp webhook…');
  await reRegisterClickUpWebhook(url);

  console.log('re-registering Wrike webhook…');
  await reRegisterWrikeWebhook(url);

  // The running server caches APP_URL at boot; nudge tsx watch so a later
  // `/connect` computes webhook URLs against the fresh value.
  await sh('touch src/server.ts');

  console.log(`  /health → ${(await (await fetch(`${url}/health`)).text()).slice(0, 60)}`);
  console.log('\n✅ Done. cloudflared runs detached (stop: pkill -f cloudflared).');
  console.log('   Webhook delivery is incoming — it does not depend on APP_URL.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
