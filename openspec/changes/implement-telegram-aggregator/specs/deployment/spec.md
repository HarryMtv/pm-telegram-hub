# deployment

## ADDED Requirements

### Requirement: Docker Compose stack
Deployment SHALL run on a single VPS via Docker Compose with services: `app` (Integration Service + bot), `worker` (BullMQ worker, independently scalable), `redis` (redis:7-alpine with persistent volume), `nginx` (reverse proxy + Mini App static files), with restart policies.

#### Scenario: Worker scaling
- **WHEN** queue depth grows
- **THEN** worker replicas can be scaled independently of the app service

### Requirement: HTTPS and routing
nginx SHALL terminate TLS (Let's Encrypt, TLS 1.2+) - HTTPS is mandatory for Telegram webhooks and Mini App. Subdomain `api.` proxies `/webhooks/*` and `/api/*` to `app`; subdomain `app.` serves the Vite build.

#### Scenario: HTTP request
- **WHEN** a request arrives over plain HTTP
- **THEN** it is redirected to HTTPS

### Requirement: Health check
The service SHALL expose `GET /health` returning `{ "status": "ok", "queue": "ok", "timestamp": ... }`, including queue connectivity.

#### Scenario: Redis down
- **WHEN** Redis is unavailable
- **THEN** the health endpoint reports a non-ok queue status

### Requirement: Logging and metrics
Logs SHALL go through Pino to stdout (journald/file with logrotate). Monitoring SHALL cover: webhook delivery success per provider, event-to-message latency, remaining rate limit per connection, expired-token counter, and BullMQ queue depth.

#### Scenario: Debugging a missed notification
- **WHEN** an operator investigates a missed notification
- **THEN** structured logs allow tracing the event from webhook receipt through delivery

### Requirement: Configuration via environment
All configuration SHALL come from environment variables per spec section 9 (`APP_URL`, `MINIAPP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ENCRYPTION_KEY`, `TELEGRAM_BOT_TOKEN`, `BOT_MODE`, `TELEGRAM_WEBHOOK_SECRET`, `REDIS_URL`, provider rate-limit defaults). The Supabase service key exists only on the backend.

#### Scenario: Environment bootstrap
- **WHEN** the stack starts with a complete `.env`
- **THEN** no configuration is read from any other source

