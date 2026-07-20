# Design: implement-telegram-aggregator

## Context

Greenfield repository: no application code yet. The source of truth is the product specification (v2.3), which defines a Telegram aggregator for work systems: an Integration Service receiving provider webhooks, a Telegram bot for notifications and quick actions, and a Mini App for onboarding, subscriptions, and a unified inbox. Phase 1 ships ClickUp + Wrike; Phase 3 adds Jira Cloud. Solo development, single VPS deployment, managed Supabase.

Constraints:

- The core must be strictly provider-agnostic; all provider knowledge lives in adapters.
- Providers deactivate webhooks on slow/failed responses - the webhook endpoint must ACK fast.
- Telegram Bot API rate limits (30 msg/s global, 1 msg/s per private chat, 20 msg/min per group).
- Users authenticate via Telegram, not Supabase Auth - classic `auth.uid()` RLS does not apply.
- HTTPS mandatory for Telegram webhooks and Mini App.
