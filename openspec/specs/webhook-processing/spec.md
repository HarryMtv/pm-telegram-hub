# webhook-processing

## Purpose

The webhook ingest pipeline: raw-body signature verification, fast-ACK, queueing, and worker fan-out.

## Requirements

### Requirement: Fast-ACK parameterized webhook endpoint

The system SHALL expose a single endpoint `POST /webhooks/:provider` that resolves the adapter from the registry, handles handshakes, reads the raw body, verifies the signature (secret looked up by webhook id from payload/headers), enqueues a BullMQ job with the payload as-is, and responds 200 immediately. Providers deactivate webhooks after slow/failed responses, so no heavy processing may happen in the HTTP handler.

#### Scenario: Normal delivery

- **WHEN** a valid signed webhook arrives at `POST /webhooks/clickup`
- **THEN** the payload is enqueued and the endpoint responds 200 before any provider API call or DB-heavy processing

#### Scenario: Unknown provider

- **WHEN** a request arrives for a provider not present in the adapter registry
- **THEN** the endpoint responds with an error and enqueues nothing

#### Scenario: Handshake short-circuit

- **WHEN** `adapter.handleHandshake(headers)` returns a response
- **THEN** the endpoint returns that response immediately without enqueueing a job

### Requirement: Raw body preservation

The webhook route SHALL capture the raw request bytes (Fastify raw-body configuration) because HMAC signatures are computed over original bytes.

#### Scenario: JSON with unusual formatting

- **WHEN** a provider sends a payload whose re-serialized JSON would differ byte-wise from the original
- **THEN** signature verification still succeeds because it uses the raw bytes

### Requirement: Async worker pipeline

A BullMQ worker SHALL process each job: (1) `parseEvents(payload, headers)`; (2) per event: `enrichEvent` for minimal-payload providers via the connection owner's rate limiter; (3) find active subscriptions for the connection applying container filters from task data; (4) per subscription, insert into `notification_log` with `ON CONFLICT (subscription_id, dedupe_key) DO NOTHING` and skip on conflict; (5) render the message template and send it through the Telegram limiter; (6) record `telegram_message_id`.

#### Scenario: Duplicate event skipped

- **WHEN** an event with a `dedupeKey` already logged for a subscription is processed
- **THEN** the DB insert conflicts and no Telegram message is sent for that subscription

#### Scenario: Container filter mismatch

- **WHEN** an event's task container does not match a subscription's container filters
- **THEN** that subscription receives no notification

### Requirement: Retries and dead-letter queue

Failed jobs SHALL be retried with exponential backoff; after N attempts the job moves to a dead-letter queue for inspection.

#### Scenario: Transient provider outage

- **WHEN** `enrichEvent` fails due to a provider 5xx error
- **THEN** BullMQ retries the job with exponential backoff and moves it to the DLQ after exhausting attempts
