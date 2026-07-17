# Deploy to your own VPS (Docker Compose + nginx)

This is the plain-Docker path (spec §11): the root
[`docker-compose.yml`](../docker-compose.yml) runs `app`, `worker`, `redis`, and
an `nginx` reverse proxy that terminates TLS and routes traffic. Use this when
you manage the server yourself and don't run a PaaS like
[Coolify](deploy-coolify.md).

```
Internet ──► nginx (TLS, :443) ──► app  (Fastify + grammY bot, :3000)
                                     │
                                     ▼
                                   redis (BullMQ)  ◄──  worker
```

## Prerequisites

- A VPS (2 GB RAM is comfortable) running a recent Linux with **Docker** and the
  **Docker Compose plugin**.
- A domain with a DNS **A record** for `api.your-domain.com` pointing at the VPS.
  (`app.your-domain.com` is only needed once the Phase 2 Mini App is deployed.)
- A **Supabase** project (URL + service-role key + `DATABASE_URL`).
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- Ports **80** and **443** open in the firewall.

## 1. Get the code and configure

```bash
git clone <this-repo> pm-telegram-hub
cd pm-telegram-hub
cp .env.example .env
```

Edit `.env`. For production set:

```dotenv
NODE_ENV=production
APP_URL=https://api.your-domain.com
MINIAPP_URL=https://api.your-domain.com   # any valid URL until the Mini App ships

SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>

ENCRYPTION_KEY=<openssl rand -hex 32>     # generate once, NEVER change it later

TELEGRAM_BOT_TOKEN=<from @BotFather>
BOT_MODE=webhook                          # webhook in production
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 24>

JWT_SECRET=<openssl rand -hex 24>
```

`REDIS_URL` is overridden to `redis://redis:6379` by the compose file, so leave
it as-is. The app **fails fast** if any required value is missing.

> **`ENCRYPTION_KEY` is permanent.** All stored provider credentials and webhook
> secrets are encrypted with it — rotating it makes them unrecoverable.

## 2. Run the database migrations (from a machine that can reach Supabase)

The production image does not carry the migration tooling, so apply migrations
with the direct Supabase connection string (locally or from the VPS with pnpm
installed):

```bash
DATABASE_URL="postgresql://postgres:...@db.<project>.supabase.co:5432/postgres?sslmode=require" \
  pnpm migrate
```

Migration `0002_rls.sql` relies on Supabase's `auth.jwt()` and must run against
the Supabase database. Re-run whenever `migrations/` changes.

## 3. Point nginx at your domain

Edit [`docker/nginx.conf`](../docker/nginx.conf) and replace every
`api.your-domain.com` (and `app.your-domain.com`, for later) with your real
domain. For Phase 1 you only need the `api.` server block — webhooks, `/api`,
and `/health`.

## 4. Obtain TLS certificates

nginx expects Let's Encrypt certs under `/etc/letsencrypt`, which the compose
file mounts from `./docker/certs`. Issue them with certbot into that directory
(port 80 must be free during the challenge):

```bash
sudo certbot certonly --standalone \
  -d api.your-domain.com \
  --config-dir ./docker/certs \
  --work-dir ./docker/certs \
  --logs-dir ./docker/certs
```

This produces `./docker/certs/live/api.your-domain.com/{fullchain,privkey}.pem`,
which nginx reads read-only. (Add `-d app.your-domain.com` once you deploy the
Mini App.)

## 5. Build and start

```bash
docker compose up -d --build
```

This starts `app`, `worker`, `redis`, and `nginx`. Check status:

```bash
docker compose ps
docker compose logs -f app        # look for "bot started (webhook mode)"
```

On boot the app registers the Telegram webhook at `${APP_URL}/api/telegram`.

## 6. Verify

- **Health:** `curl https://api.your-domain.com/health` →
  `{ "ok": true, "checks": { "queue": true }, ... }`.
- **Signature/security:** a webhook with a bad signature returns `401` and
  enqueues nothing; an unknown provider returns `404`.
- Walk the full runbook in [`verification.md`](verification.md) (connect →
  subscribe → trigger a notification → inline actions).

## Operating the deployment

- **Update:** `git pull && docker compose up -d --build`. If the pull includes
  new `migrations/`, run step 2 first.
- **Scale the worker:** `docker compose up -d --scale worker=3`. The worker is
  stateless and pulls jobs from Redis; the app does not scale with it.
- **Logs:** `docker compose logs -f app worker`.
- **Renew certs:** re-run the certbot command (or add a cron job) and
  `docker compose restart nginx` to pick up the new files.
- **Backups:** application state lives in Supabase (back it up there). The only
  local state is the `redis-data` volume, an in-flight job queue — losing it does
  not lose delivered notifications.

## Troubleshooting

- **App exits on start with "Invalid environment configuration".** A required
  `.env` value is missing/invalid — the error lists which one.
- **Telegram webhook not registered.** `APP_URL` must be a public HTTPS URL with
  a valid certificate before the app boots. Confirm nginx serves TLS
  (`curl -I https://api.your-domain.com/health`) and check the `app` logs.
- **`502` from nginx.** The `app` container isn't healthy yet — check
  `docker compose logs app` and that its `/health` passes.
- **`queue: false` in `/health`.** Redis is down or unreachable; check
  `docker compose logs redis`.
