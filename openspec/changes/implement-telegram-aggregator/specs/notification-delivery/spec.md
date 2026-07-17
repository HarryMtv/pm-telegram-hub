# notification-delivery

## ADDED Requirements

### Requirement: Telegram rate-limit compliance
The notifier SHALL respect Telegram Bot API limits: ~30 messages/sec globally, ~1 message/sec per private chat, 20 messages/min per group. Implementation: per-chat token bucket plus a global limiter.

#### Scenario: Burst to one group
- **WHEN** many events target the same group chat in a short window
- **THEN** the notifier throttles sends to stay within 20 messages/min for that group

### Requirement: Digest batching for groups
On event bursts to a single group chat, the notifier SHALL collapse notifications into a digest message instead of sending them individually.

#### Scenario: Sprint start burst
- **WHEN** dozens of task events for one group arrive within the batching window
- **THEN** the group receives a single digest message summarizing them

### Requirement: Delivery idempotency
Delivery SHALL be idempotent at the database level via `notification_log` `unique(subscription_id, dedupe_key)`. Successful sends record `telegram_message_id`.

#### Scenario: Worker retry after partial failure
- **WHEN** a job is retried after some notifications were already delivered
- **THEN** already-delivered (subscription, dedupe_key) pairs are skipped and no duplicate messages are sent

