import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';

import { withConnection } from '../adapters/context.js';
import { findStatusByCategory } from '../adapters/contract-helpers.js';
import { registry } from '../adapters/index.js';
import type { ProviderAdapter } from '../adapters/provider-adapter.js';
import { rateLimiters } from '../adapters/rate-limiter.js';
import type { ProviderCredentials, StatusCategory } from '../adapters/types.js';
import { config } from '../config/index.js';
import { decryptJson } from '../crypto/index.js';
import type { ProviderConnectionRow } from '../db/client.js';
import { getConnectionById, listConnectionsForUser } from '../db/connections.js';
import { getDefaultMapping, listMappingsForUser, upsertMapping } from '../db/mappings.js';
import {
  deleteSubscription,
  listSubscriptionsForChat,
  upsertSubscription,
} from '../db/subscriptions.js';
import { upsertUserByTelegram } from '../db/users.js';
import { logger } from '../logger.js';
import type { StatusDef } from '../models/unified.js';
import { escapeHtml, providerLabel, renderTaskCard } from '../notifier/templates.js';
import { connectProvider } from '../services/connection-service.js';
import { actionKeyboard, decodeCallback, decodeReply } from './callbacks.js';

/** Create/refresh the users row from the Telegram identity; returns the user id. */
async function ensureUser(ctx: {
  from?: { id: number; username?: string; first_name?: string; last_name?: string };
}): Promise<string> {
  const from = ctx.from;
  if (!from) throw new Error('update has no user');
  const user = await upsertUserByTelegram({
    telegramId: from.id,
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
  });
  return user.id;
}

type ConnResult = { conn: ProviderConnectionRow } | { error: string };

/** Resolve the connection a command should act on: by provider arg, or the only one. */
async function resolveConnection(userId: string, providerArg?: string): Promise<ConnResult> {
  const conns = (await listConnectionsForUser(userId)).filter((c) => c.is_active);
  if (conns.length === 0) return { error: 'No connections yet. Run /connect first.' };
  if (providerArg) {
    const conn = conns.find((c) => c.provider === providerArg);
    return conn ? { conn } : { error: `No ${providerLabel(providerArg)} connection.` };
  }
  if (conns.length === 1) return { conn: conns[0]! };
  return {
    error: `Multiple connections (${conns.map((c) => c.provider).join(', ')}). Specify a provider.`,
  };
}

/** Run an adapter call inside the connection's rate-limit context. */
async function runWithConn<R>(
  conn: ProviderConnectionRow,
  fn: (adapter: ProviderAdapter, creds: ProviderCredentials) => Promise<R>,
): Promise<R> {
  const adapter = registry.get(conn.provider);
  const creds = decryptJson<ProviderCredentials>(conn.credentials);
  const connection = {
    id: conn.id,
    provider: conn.provider,
    scopeId: conn.scope_id,
    credentials: creds,
  };
  const limiter = rateLimiters.forConnection(conn.id, adapter.rateLimit(connection));
  return withConnection({ connection, limiter }, () => fn(adapter, creds));
}

const STATUS_KEYWORDS: Record<string, StatusCategory> = {
  done: 'done',
  complete: 'done',
  completed: 'done',
  progress: 'in_progress',
  'in-progress': 'in_progress',
  inprogress: 'in_progress',
  open: 'open',
  todo: 'open',
  cancel: 'cancelled',
  cancelled: 'cancelled',
};

/** Pick a status by category keyword or name match. */
function pickStatus(statuses: StatusDef[], arg: string): StatusDef | undefined {
  const kw = arg.toLowerCase();
  const category = STATUS_KEYWORDS[kw];
  if (category) return findStatusByCategory(statuses, category);
  return statuses.find((s) => s.name.toLowerCase().includes(kw));
}

/** Split off an optional leading provider token from command args. */
function splitProviderArg(parts: string[]): { provider?: string; rest: string[] } {
  if (parts.length > 1 && registry.has(parts[0]!)) {
    return { provider: parts[0], rest: parts.slice(1) };
  }
  return { rest: parts };
}

interface PendingReply {
  userId: string;
  connectionId: string;
  provider: string;
  taskId: string;
  actorId: string;
}

/** Reply-flow state: a force_reply prompt's message id → what to post. In-memory
 * (single instance); each entry auto-expires so abandoned prompts don't leak. */
const pendingReplies = new Map<number, PendingReply>();

export function registerCommands(bot: Bot): void {
  // Reply fulfillment (registered before commands so it consumes prompt replies):
  // post a provider comment that @mentions the original comment's author.
  bot.on('message:text', async (ctx, next) => {
    const replyTo = ctx.msg.reply_to_message;
    const pending = replyTo ? pendingReplies.get(replyTo.message_id) : undefined;
    if (!pending) {
      await next();
      return;
    }
    pendingReplies.delete(replyTo!.message_id);
    const text = (ctx.msg.text ?? '').trim();
    if (!text) {
      await ctx.reply('Empty reply — cancelled.');
      return;
    }
    const conn = await getConnectionById(pending.connectionId);
    if (!conn || conn.user_id !== pending.userId) {
      await ctx.reply('No access to this connection.');
      return;
    }
    try {
      await runWithConn(conn, (a, c) =>
        a.addComment(c, pending.taskId, text, { mentions: [pending.actorId] }),
      );
      await ctx.reply('✅ Reply posted with a mention of the author.');
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`);
    }
  });

  bot.command('start', async (ctx) => {
    await ensureUser(ctx);
    const keyboard = new InlineKeyboard().webApp(' Open Mini App', config.miniAppUrl);
    await ctx.reply(
      '👋 Hi! I aggregate work systems (ClickUp, Wrike) into one chat.\n\n' +
        '/connect — connect a provider\n/subscribe — subscribe this chat to notifications\n/help — help',
      { reply_markup: keyboard },
    );
  });

  bot.command('help', async (ctx) =>
    ctx.reply(
      [
        '/connect <provider> <token> — connect (the token is deleted from chat)',
        '/subscribe [provider] [me] — subscribe this chat (me = only tasks assigned to you)',
        '/unsubscribe [provider] — unsubscribe this chat',
        'Providers with multiple fields (Jira) are connected via the Mini App.',
        '',
        'Inline buttons under notifications: 💪 Take · ✅ Done · 💬 Comment',
        'Full reference: see docs/bot-commands.md',
      ].join('\n'),
    ),
  );

  bot.command('connect', async (ctx) => {
    const parts = (ctx.msg.text ?? '').split(/\s+/);
    const provider = parts[1];
    const token = parts.slice(2).join(' ').trim();
    if (!provider || !token) {
      await ctx.reply('Usage: /connect <provider> <token>');
      return;
    }
    if (!registry.has(provider)) {
      await ctx.reply(`Unknown provider: ${escapeHtml(provider)}`);
      return;
    }
    const adapter = registry.get(provider);
    const fields = adapter.credentialFields();
    if (fields.length !== 1 || fields[0]?.type !== 'token') {
      await ctx.reply(
        `${providerLabel(provider)} needs multiple fields — connect via the Mini App.`,
      );
      return;
    }

    const userId = await ensureUser(ctx);
    try {
      const result = await connectProvider(userId, provider, { token });
      await ctx.reply(
        `✅ Connected ${providerLabel(provider)}.` +
          (result.webhookRegistered
            ? ' Webhook registered.'
            : ' Webhook is configured separately.'),
      );
    } catch (err) {
      logger.warn({ err: (err as Error).message, provider }, 'connect failed');
      await ctx.reply(`❌ Failed to connect: ${escapeHtml((err as Error).message)}`);
      return;
    }

    // Remove the token from chat history.
    try {
      await ctx.deleteMessage();
    } catch {
      // best-effort — older messages can't be deleted
    }
  });

  bot.command('subscribe', async (ctx) => {
    const userId = await ensureUser(ctx);
    const chatId = ctx.chat.id;
    const parts = (ctx.msg.text ?? '').split(/\s+/).slice(1).filter(Boolean);
    const onlyMine = parts.includes('me');
    const providerArg = parts.find((p) => p !== 'me');
    const connections = (await listConnectionsForUser(userId)).filter((c) => c.is_active);
    const target = providerArg
      ? connections.filter((c) => c.provider === providerArg)
      : connections;
    if (target.length === 0) {
      await ctx.reply('No matching connection. Run /connect first.');
      return;
    }
    for (const conn of target) {
      // `/subscribe me` resolves the connection owner's user id once and stores it
      // in filters.assignee; the worker then drops events for tasks they aren't on.
      let filters: Record<string, unknown> | undefined;
      if (onlyMine) {
        try {
          const account = await runWithConn(conn, (a, c) => a.verifyCredentials(c));
          filters = { assignee: account.externalId };
        } catch (err) {
          await ctx.reply(
            `❌ Couldn't resolve your ${providerLabel(conn.provider)} profile: ${escapeHtml((err as Error).message)}`,
          );
          return;
        }
      }
      await upsertSubscription({ userId, connectionId: conn.id, telegramChatId: chatId, filters });
    }
    await ctx.reply(
      onlyMine
        ? `✅ Subscribed to tasks assigned to you only (${target.length}).`
        : `✅ Chat subscribed to ${target.length} connection(s).`,
    );
  });

  bot.command('unsubscribe', async (ctx) => {
    const userId = await ensureUser(ctx);
    const chatId = ctx.chat.id;
    const subs = await listSubscriptionsForChat(userId, chatId);
    for (const sub of subs) await deleteSubscription(sub.id);
    await ctx.reply(`Unsubscribed: ${subs.length}.`);
  });

  // ── Task commands (Phase 2) ──────────────────────────────────────────────────

  bot.command('newtask', async (ctx) => {
    const userId = await ensureUser(ctx);
    const rest = (ctx.msg.text ?? '').replace(/^\/newtask(\@\S+)?\s*/, '');
    const aliasMatch = rest.match(/#([\w-]+)/);
    const alias = aliasMatch?.[1];
    const name = rest.replace(/#[\w-]+/, '').trim();
    if (!name) {
      await ctx.reply('Usage: /newtask <name> [#alias]');
      return;
    }

    let provider: string | undefined;
    let containerId: string | undefined;
    if (alias) {
      const mapping = (await listMappingsForUser(userId)).find((m) => m.alias === alias);
      if (!mapping) {
        await ctx.reply(`No alias "${alias}". Create one: /map ${alias} <containerId>`);
        return;
      }
      provider = mapping.provider;
      containerId = mapping.container_id;
    } else {
      const res = await resolveConnection(userId);
      if ('error' in res) {
        await ctx.reply(res.error);
        return;
      }
      provider = res.conn.provider;
      const def = await getDefaultMapping(userId, provider);
      if (!def) {
        await ctx.reply('No default container. Run /map <alias> <containerId> default');
        return;
      }
      containerId = def.container_id;
    }

    const res = await resolveConnection(userId, provider);
    if ('error' in res) {
      await ctx.reply(res.error);
      return;
    }
    try {
      const ref = await runWithConn(res.conn, (a, c) => a.createTask(c, { name, containerId }));
      await ctx.reply(`✅ Created: ${ref.url}`);
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`);
    }
  });

  bot.command('task', async (ctx) => {
    const userId = await ensureUser(ctx);
    const parsed = splitProviderArg((ctx.msg.text ?? '').split(/\s+/).slice(1).filter(Boolean));
    const taskId = parsed.rest[0];
    if (!taskId) {
      await ctx.reply('Usage: /task [provider] <id>');
      return;
    }
    const res = await resolveConnection(userId, parsed.provider);
    if ('error' in res) {
      await ctx.reply(res.error);
      return;
    }
    try {
      const task = await runWithConn(res.conn, (a, c) => a.getTask(c, taskId));
      await ctx.reply(renderTaskCard(task), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: actionKeyboard(task.provider, taskId, res.conn.id),
      });
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`);
    }
  });

  bot.command('comment', async (ctx) => {
    const userId = await ensureUser(ctx);
    const parsed = splitProviderArg((ctx.msg.text ?? '').split(/\s+/).slice(1));
    const taskId = parsed.rest[0];
    const text = parsed.rest.slice(1).join(' ').trim();
    if (!taskId || !text) {
      await ctx.reply('Usage: /comment [provider] <id> <text>');
      return;
    }
    const res = await resolveConnection(userId, parsed.provider);
    if ('error' in res) {
      await ctx.reply(res.error);
      return;
    }
    try {
      await runWithConn(res.conn, (a, c) => a.addComment(c, taskId, text));
      await ctx.reply('💬 Comment added');
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`);
    }
  });

  bot.command('status', async (ctx) => {
    const userId = await ensureUser(ctx);
    const parsed = splitProviderArg((ctx.msg.text ?? '').split(/\s+/).slice(1));
    const taskId = parsed.rest[0];
    const statusArg = parsed.rest.slice(1).join(' ').trim();
    if (!taskId || !statusArg) {
      await ctx.reply('Usage: /status [provider] <id> <status|done|in-progress|...>');
      return;
    }
    const res = await resolveConnection(userId, parsed.provider);
    if ('error' in res) {
      await ctx.reply(res.error);
      return;
    }
    try {
      const statuses = await runWithConn(res.conn, (a, c) => a.getAvailableStatuses(c, taskId));
      const picked = pickStatus(statuses, statusArg);
      if (!picked) {
        await ctx.reply(`Unavailable. Available: ${statuses.map((s) => s.name).join(', ')}`);
        return;
      }
      await runWithConn(res.conn, (a, c) => a.setStatus(c, taskId, picked.id));
      await ctx.reply(`✅ Status: ${picked.name}`);
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`);
    }
  });

  bot.command('assign', async (ctx) => {
    const userId = await ensureUser(ctx);
    const parsed = splitProviderArg((ctx.msg.text ?? '').split(/\s+/).slice(1));
    const taskId = parsed.rest[0];
    const assignee = (parsed.rest[1] ?? '').replace(/^@/, '');
    if (!taskId || !assignee) {
      await ctx.reply('Usage: /assign [provider] <id> @userId');
      return;
    }
    const res = await resolveConnection(userId, parsed.provider);
    if ('error' in res) {
      await ctx.reply(res.error);
      return;
    }
    try {
      await runWithConn(res.conn, (a, c) => a.updateTask(c, taskId, { addAssignees: [assignee] }));
      await ctx.reply('✅ Assigned');
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`);
    }
  });

  bot.command('due', async (ctx) => {
    const userId = await ensureUser(ctx);
    const parsed = splitProviderArg((ctx.msg.text ?? '').split(/\s+/).slice(1));
    const taskId = parsed.rest[0];
    const due = parsed.rest.slice(1).join(' ').trim();
    if (!taskId || !due) {
      await ctx.reply('Usage: /due [provider] <id> <date>');
      return;
    }
    const res = await resolveConnection(userId, parsed.provider);
    if ('error' in res) {
      await ctx.reply(res.error);
      return;
    }
    try {
      await runWithConn(res.conn, (a, c) => a.updateTask(c, taskId, { dueDate: due }));
      await ctx.reply('✅ Due date updated');
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`);
    }
  });

  bot.command('browse', async (ctx) => {
    const userId = await ensureUser(ctx);
    const providerArg = (ctx.msg.text ?? '').split(/\s+/)[1];
    const res = await resolveConnection(
      userId,
      providerArg && registry.has(providerArg) ? providerArg : undefined,
    );
    if ('error' in res) {
      await ctx.reply(res.error);
      return;
    }
    try {
      const containers = await runWithConn(res.conn, (a, c) => a.listContainers(c));
      const text = containers
        .slice(0, 50)
        .map(
          (c) =>
            `${c.canContainTasks ? '📋' : '📁'} ${escapeHtml(c.name)} — <code>${escapeHtml(c.id)}</code>`,
        )
        .join('\n');
      await ctx.reply(text || 'No containers found', { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`);
    }
  });

  bot.command('map', async (ctx) => {
    const userId = await ensureUser(ctx);
    const parts = (ctx.msg.text ?? '').split(/\s+/).slice(1);
    const alias = parts[0];
    const containerId = parts[1];
    if (!alias || !containerId) {
      await ctx.reply('Usage: /map <alias> <containerId> [provider] [default]');
      return;
    }
    const isDefault = parts.includes('default');
    const providerArg = parts[2] && registry.has(parts[2]) ? parts[2] : undefined;
    const res = await resolveConnection(userId, providerArg);
    if ('error' in res) {
      await ctx.reply(res.error);
      return;
    }
    await upsertMapping({ userId, provider: res.conn.provider, alias, containerId, isDefault });
    await ctx.reply(`✅ Alias ${alias} → ${containerId}${isDefault ? ' (default)' : ''}`);
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    // "Reply" under a comment → prompt for text, then post a provider comment
    // that @mentions the author (a real ping in ClickUp).
    const replyTarget = decodeReply(data);
    if (replyTarget) {
      const userId = await ensureUser(ctx);
      const res = await resolveConnection(userId, replyTarget.provider);
      if ('error' in res) {
        await ctx.answerCallbackQuery({ text: res.error });
        return;
      }
      const sent = await ctx.reply('↩️ Type your reply — I will mention the author in ClickUp:', {
        reply_markup: { force_reply: true, selective: true },
      });
      const promptId = sent.message_id;
      pendingReplies.set(promptId, {
        userId,
        connectionId: res.conn.id,
        provider: replyTarget.provider,
        taskId: replyTarget.taskId,
        actorId: replyTarget.actorId,
      });
      setTimeout(() => pendingReplies.delete(promptId), 10 * 60 * 1000).unref();
      await ctx.answerCallbackQuery({ text: 'Awaiting your reply' });
      return;
    }
    const target = decodeCallback(data);
    if (!target) {
      await ctx.answerCallbackQuery();
      return;
    }
    const userId = await ensureUser(ctx);
    const conn = await getConnectionById(target.connectionId);
    if (!conn || conn.user_id !== userId) {
      await ctx.answerCallbackQuery({ text: 'No access' });
      return;
    }
    const adapter = registry.get(target.provider);
    const creds = decryptJson<Record<string, string>>(conn.credentials);
    const connection = {
      id: conn.id,
      provider: conn.provider,
      scopeId: conn.scope_id,
      credentials: creds,
    };
    const limiter = rateLimiters.forConnection(conn.id, adapter.rateLimit(connection));

    if (target.action === 'done' || target.action === 'take') {
      const category: StatusCategory = target.action === 'done' ? 'done' : 'in_progress';
      try {
        const statuses = await withConnection({ connection, limiter }, () =>
          adapter.getAvailableStatuses(creds, target.taskId),
        );
        const status = findStatusByCategory(statuses, category);
        if (!status) {
          await ctx.answerCallbackQuery({ text: 'Status unavailable' });
          return;
        }
        await withConnection({ connection, limiter }, () =>
          adapter.setStatus(creds, target.taskId, status.id),
        );
        await ctx.answerCallbackQuery({
          text: target.action === 'done' ? '✅ Done' : '💪 In progress',
        });
      } catch (err) {
        await ctx.answerCallbackQuery({ text: `Error: ${(err as Error).message}` });
      }
      return;
    }

    // comment → multi-step, route to Mini App / /comment (Phase 2).
    await ctx.answerCallbackQuery();
    await ctx.reply(`Comment: /comment ${escapeHtml(target.taskId)} <text>`);
  });
}
