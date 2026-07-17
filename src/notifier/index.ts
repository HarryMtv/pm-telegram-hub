import { keyboardFor } from '../bot/callbacks.js';
import { getBotApi } from '../bot/instance.js';
import { logger } from '../logger.js';
import type { UnifiedEvent } from '../models/unified.js';
import { acquireTelegramSlot } from './limiter.js';
import { renderEvent } from './templates.js';

export interface DeliverOptions {
  /** Attach Take/Done/Comment inline buttons (notifications, task cards). */
  showActions?: boolean;
  /** Required when showActions is true (encoded into callback_data). */
  connectionId?: string;
}

export interface SendMessageOptions {
  parse_mode: 'HTML';
  link_preview_options: { is_disabled: boolean };
  reply_markup?: unknown;
}

export type TelegramSender = (
  chatId: number,
  text: string,
  opts: SendMessageOptions,
) => Promise<number>;

const defaultSender: TelegramSender = async (chatId, text, opts) => {
  const message = await getBotApi().sendMessage(chatId, text, opts as never);
  return message.message_id;
};

// Swappable so tests can run the pipeline without hitting Telegram.
let _sender: TelegramSender = defaultSender;

export function setNotifierSender(sender: TelegramSender): void {
  _sender = sender;
}

export function resetNotifierSender(): void {
  _sender = defaultSender;
}

/**
 * Render the unified template, respect Telegram limits, and send. Returns the
 * Telegram message id (recorded in notification_log for traceability).
 */
export async function deliverEvent(
  chatId: number,
  event: UnifiedEvent,
  opts: DeliverOptions = {},
): Promise<number> {
  const text = renderEvent(event);
  await acquireTelegramSlot(chatId);

  const replyMarkup =
    opts.showActions !== false && opts.connectionId
      ? keyboardFor(event, opts.connectionId)
      : undefined;

  const messageId = await _sender(chatId, text, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: replyMarkup,
  });

  logger.debug(
    { chatId, eventType: event.eventType, taskId: event.taskId },
    'notification delivered',
  );
  return messageId;
}
