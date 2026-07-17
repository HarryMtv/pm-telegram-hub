import { getSupabase } from './client.js';

/**
 * Idempotent delivery log insert. The `unique(subscription_id, dedupe_key)`
 * constraint is the idempotency guarantee: a redelivered webhook yields the same
 * dedupe_key, the insert conflicts, and `tryInsertNotification` returns false so
 * the worker skips sending a duplicate message.
 *
 * Returns true when the row was newly inserted (i.e. this is the first delivery
 * for this subscription+dedupe_key).
 */
export async function tryInsertNotification(
  subscriptionId: string,
  dedupeKey: string,
  eventType: string,
): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('notification_log')
    .upsert(
      { subscription_id: subscriptionId, dedupe_key: dedupeKey, event_type: eventType },
      { onConflict: 'subscription_id,dedupe_key', ignoreDuplicates: true },
    )
    .select()
    .maybeSingle();

  if (error) throw new Error(`tryInsertNotification failed: ${error.message}`);
  return data !== null;
}

/** Record the Telegram message id once delivery succeeds. */
export async function setNotificationMessageId(
  subscriptionId: string,
  dedupeKey: string,
  telegramMessageId: number,
): Promise<void> {
  const { error } = await getSupabase()
    .from('notification_log')
    .update({ telegram_message_id: telegramMessageId })
    .eq('subscription_id', subscriptionId)
    .eq('dedupe_key', dedupeKey);
  if (error) throw new Error(`setNotificationMessageId failed: ${error.message}`);
}
