-- 0003_connection_account.sql — store the connection owner's provider identity.
--
-- The worker uses it to suppress self-echo: an event whose actor is the
-- connection owner (a change they made via the bot or in the provider UI) is
-- not echoed back to them. { externalId, displayName } come from verifyCredentials.
alter table provider_connections
  add column if not exists account jsonb;
