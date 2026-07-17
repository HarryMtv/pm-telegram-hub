import { InlineKeyboard } from 'grammy';

/**
 * Inline-button callback data. Telegram limits `callback_data` to 64 bytes, so
 * we pack the essentials as `action|provider|connectionId|taskId`. Provider task
 * ids are short; connectionId is a uuid (~36). This fits for Phase 1 providers.
 */
export type InlineAction = 'take' | 'done' | 'comment';

export interface CallbackTarget {
  action: InlineAction;
  provider: string;
  connectionId: string;
  taskId: string;
}

export function encodeCallback(t: CallbackTarget): string {
  return `${t.action}|${t.provider}|${t.connectionId}|${t.taskId}`;
}

export function decodeCallback(data: string): CallbackTarget | null {
  const [action, provider, connectionId, taskId] = data.split('|');
  if (!action || !provider || !connectionId || !taskId) return null;
  return { action: action as InlineAction, provider, connectionId, taskId };
}

/** Build the action keyboard shown under a notification / task card. */
export function actionKeyboard(
  provider: string,
  taskId: string,
  connectionId: string,
): InlineKeyboard {
  const base = { provider, connectionId, taskId };
  return new InlineKeyboard()
    .text('💪 Take', encodeCallback({ ...base, action: 'take' }))
    .text('✅ Done', encodeCallback({ ...base, action: 'done' }))
    .row()
    .text('💬 Comment', encodeCallback({ ...base, action: 'comment' }));
}

/** A Reply intent: post a provider comment that @mentions the comment author. */
export interface ReplyTarget {
  provider: string;
  taskId: string;
  /** Stable provider id of the comment author (e.g. ClickUp user id). */
  actorId: string;
}

/** Compact reply callback_data (fits 64B): `reply|provider|taskId|actorId`. */
export function encodeReply(t: ReplyTarget): string {
  return `reply|${t.provider}|${t.taskId}|${t.actorId}`;
}

export function decodeReply(data: string): ReplyTarget | null {
  const [mark, provider, taskId, actorId] = data.split('|');
  if (mark !== 'reply' || !provider || !taskId || !actorId) return null;
  return { provider, taskId, actorId };
}

/**
 * Keyboard for comment notifications: "Comment" + "Reply". Reply opens a flow
 * that posts a provider comment @mentioning the author (a real ping), so it
 * carries the author's provider id. No Take/Done — they don't apply to a comment.
 */
export function commentKeyboard(
  provider: string,
  taskId: string,
  connectionId: string,
  authorId?: string,
): InlineKeyboard {
  const base = { provider, connectionId, taskId };
  const kb = new InlineKeyboard().text(
    '💬 Comment',
    encodeCallback({ ...base, action: 'comment' }),
  );
  if (authorId) kb.row().text('↩️ Reply', encodeReply({ provider, taskId, actorId: authorId }));
  return kb;
}

/**
 * Pick the inline keyboard by event type — the core stays provider-agnostic.
 * Comments get Comment + Reply (mention the author); everything else Take/Done/Comment.
 */
export function keyboardFor(
  event: { eventType: string; provider: string; taskId: string; actor?: string; actorId?: string },
  connectionId: string,
): InlineKeyboard {
  if (event.eventType === 'comment.added') {
    return commentKeyboard(event.provider, event.taskId, connectionId, event.actorId);
  }
  return actionKeyboard(event.provider, event.taskId, connectionId);
}
