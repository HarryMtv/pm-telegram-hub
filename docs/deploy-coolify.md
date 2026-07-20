# Deploy to Coolify

[Coolify](https://coolify.io) is a self-hosted PaaS. It runs its own reverse
proxy (Traefik) with automatic Let's Encrypt TLS, so you **do not** need the
`nginx` service from the root `docker-compose.yml`. This project ships a
Coolify-specific stack, [`docker-compose.coolify.yml`](../docker-compose.coolify.yml),
that runs three containers — `app`, `worker`, `redis` — behind Coolify's proxy.

```
Coolify proxy (Traefik, TLS)  ──►  app  (Fastify + grammY bot, port 3000)
                                     │
                                     ▼
                                   redis (BullMQ)  ◄──  worker
```

## Prerequisites

- A running Coolify instance (v4) on a server, with a wildcard or per-app DNS
  record pointing at it.
- A **Supabase** project (URL + service-role key). Coolify does not host your
  Postgres here — the app talks to managed Supabase.
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- This repository reachable by Coolify (a Git remote it can pull, or a public
  repo URL).

> **Redis** is included in the compose file. If you prefer, create a Coolify
> "Redis" database resource instead and delete the `redis` service, then point
> `REDIS_URL` at that resource's internal connection string.

## 1. Run the database migrations (once, from your machine)

Migrations are **not** run inside the container: the production image ships only
runtime dependencies (no `tsx`) and does not include `scripts/`. Apply them from
your machine (or CI) against Supabase before the first deploy, and again whenever
`migrations/` changes:

```bash
DATABASE_URL="postgresql://postgres:...@db.<project>.supabase.co:5432/postgres?sslmode=require" \
  pnpm migrate
```

Migration `0002_rls.sql` uses Supabase's `auth.jwt()` and must run against the
Supabase database (not a vanilla Postgres).

## 2. Create the resource in Coolify

1. **+ New → Resource → Docker Compose** (choose the Git source for this repo).
2. Set **Docker Compose Location** to `docker-compose.coolify.yml`.
3. Set the **Branch** you deploy from (e.g. `main`).

Coolify parses the three services and shows them in the resource.

## 3. Attach a domain to `app`

1. Open the **`app`** service → **Configuration → Domains**.
2. Add your domain, e.g. `https://api.your-domain.com`. Coolify routes it to the
   exposed port `3000` and provisions a Let's Encrypt certificate automatically.
3. Leave `worker` and `redis` without a domain (they are internal only).

## 4. Set environment variables

In the resource's **Environment Variables** tab, add the following. The compose
file interpolates them into both `app` and `worker`:

| Variable                  | Value                                                                             |
| ------------------------- | --------------------------------------------------------------------------------- |
| `APP_URL`                 | The exact HTTPS domain you attached to `app` (e.g. `https://api.your-domain.com`) |
| `MINIAPP_URL`             | Same as `APP_URL` for Phase 1 (any valid URL)                                     |
| `SUPABASE_URL`            | `https://<project>.supabase.co`                                                   |
| `SUPABASE_SERVICE_KEY`    | Supabase service-role key                                                         |
| `ENCRYPTION_KEY`          | `openssl rand -hex 32` — **generate once, never change**                          |
| `TELEGRAM_BOT_TOKEN`      | From @BotFather                                                                   |
| `TELEGRAM_WEBHOOK_SECRET` | A long random string (`openssl rand -hex 24`)                                     |
| `JWT_SECRET`              | A long random string (`openssl rand -hex 24`)                                     |

`NODE_ENV`, `PORT`, `BOT_MODE=webhook`, `REDIS_URL`, and the rate-limit defaults
are already set in the compose file — you don't need to add them.

> **Do not rotate `ENCRYPTION_KEY` after go-live.** Every provider credential and
> webhook secret in the database is encrypted with it; changing it makes them
> permanently unreadable.

## 5. Deploy

Click **Deploy**. Coolify builds the image (`Dockerfile`) and starts all three
services. On boot the app registers the Telegram webhook at
`${APP_URL}/api/telegram` (because `BOT_MODE=webhook`).

## 6. Verify

- **Health:** `curl https://api.your-domain.com/health` →
  `{ "ok": true, "checks": { "queue": true }, ... }`. The `app` container's
  healthcheck must be green in Coolify.
- **Bot:** message the bot; run `/connect clickup <token>` in a private chat. The
  token message is deleted and the bot confirms the connection.
- **Provider webhooks:** ClickUp/Wrike will POST to
  `https://api.your-domain.com/webhooks/<provider>`. Trigger a task change and
  confirm a notification arrives.

## Updating

Push to the deployed branch and click **Redeploy** (or enable Coolify's
auto-deploy webhook). If the push includes new files under `migrations/`, run
`pnpm migrate` against Supabase (step 1) as part of the release.

## Scaling the worker

The `worker` is stateless and pulls from Redis. Increase its replica count in
Coolify (or `deploy.replicas` in the compose) to process webhook jobs in
parallel; the `app` does not need to scale with it.

## How webhooks work behind Coolify's proxy

On the VPS setup nginx routes traffic; on Coolify that job belongs to the
built-in **Traefik** proxy. When you attach a domain to the `app` service
(step 3), Traefik terminates TLS and forwards **every path** of that domain to
the container on port 3000. Both webhook kinds are just ordinary POST routes on
the app, so nothing Coolify-specific has to be configured for them:

```
Telegram  ──► https://api.your-domain.com/api/telegram      ─┐
ClickUp   ──► https://api.your-domain.com/webhooks/clickup   ├─► Traefik (TLS) ─► app:3000
Wrike     ──► https://api.your-domain.com/webhooks/wrike    ─┘
```

- The **Telegram webhook** is registered by the app itself on boot
  (`BOT_MODE=webhook` → `setWebhook(${APP_URL}/api/telegram)`).
- **Provider webhooks** are registered at `/connect` time — the adapter POSTs its
  callback URL (`${APP_URL}/webhooks/<provider>`) to ClickUp/Wrike.

Every one of those URLs is derived from **`APP_URL`**, which makes a few things
matter:

1. **`APP_URL` must equal the domain you attached to `app`** — scheme + host, no
   trailing path. This value is baked into each webhook registration, so set it
   _before_ the first `/connect`.
2. **Changing the domain later means re-connecting providers.** The old callback
   URL is already stored on ClickUp/Wrike's side; updating `APP_URL` does not
   rewrite it retroactively. Run `/connect` again (or re-register the webhook)
   after a domain change. The Telegram webhook, by contrast, re-points itself on
   the next boot.
3. **Signature verification still works.** Traefik forwards the request body
   unmodified and the app verifies HMAC over the raw bytes (`req.rawBody`, with
   `trustProxy: true`) — exactly as it does behind nginx.
4. **The certificate must be live before the app boots.** `setWebhook` runs once
   at startup; if you deploy before Coolify has issued the Let's Encrypt cert,
   Telegram rejects the registration — just **Redeploy** once the domain is green.
   Provider webhooks are unaffected (they register later, at `/connect`).
5. **Attach the domain to `app` only** (not `worker`/`redis`), with no sub-path,
   and to port `3000` if Coolify asks.

## Troubleshooting

- **A container restarts immediately / "Invalid environment configuration".** A
  required env var is missing. Because config is validated globally, this hits
  `worker` too even for vars it doesn't use (e.g. `APP_URL`) — make sure the full
  set from step 4 is present.
- **Telegram webhook not set.** `APP_URL` must be the public HTTPS domain and the
  certificate must be valid before the app boots; check the `app` logs for
  `bot started (webhook mode)`.
- **`queue: false` in `/health`.** The `redis` service isn't reachable — confirm
  it's healthy and `REDIS_URL` is `redis://redis:6379`.
