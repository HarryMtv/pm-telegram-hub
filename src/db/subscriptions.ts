import { getSupabase, SubscriptionRow } from './client.js';

export interface NewSubscription {
  userId: string;
  connectionId: string;
  telegramChatId: number;
  eventTypes?: string[];
  filters?: Record<string, unknown>;
}

const DEFAULT_EVENT_TYPES = [
  'task.created',
  'task.updated',
  'task.assigned',
  'task.status_changed',
  'task.due_changed',
  'comment.added',
];

/**
 * Idempotent subscribe: the `unique(connection_id, telegram_chat_id)` constraint
 * prevents duplicates. Re-subscribing refreshes filters/event types and returns
 * the (possibly pre-existing) row.
 */
export async function upsertSubscription(input: NewSubscription): Promise<SubscriptionRow> {
  const { data, error } = await getSupabase()
    .from('subscriptions')
    .upsert(
      {
        user_id: input.userId,
        connection_id: input.connectionId,
        telegram_chat_id: input.telegramChatId,
        event_types: input.eventTypes ?? DEFAULT_EVENT_TYPES,
        filters: input.filters ?? {},
        is_active: true,
      },
      { onConflict: 'connection_id,telegram_chat_id' },
    )
    .select()
    .single();

  if (error || !data) throw new Error(`upsertSubscription failed: ${error?.message ?? 'no row'}`);
  return data;
}

/** Worker fan-out: active subscriptions for a connection. */
export async function listActiveSubscriptionsForConnection(
  connectionId: string,
): Promise<SubscriptionRow[]> {
  const { data, error } = await getSupabase()
    .from('subscriptions')
    .select()
    .eq('connection_id', connectionId)
    .eq('is_active', true);
  if (error) throw new Error(`listActiveSubscriptionsForConnection failed: ${error.message}`);
  return data ?? [];
}

/** Used by `/unsubscribe` (removes from this chat for this connection). */
export async function listSubscriptionsForChat(
  userId: string,
  telegramChatId: number,
): Promise<SubscriptionRow[]> {
  const { data, error } = await getSupabase()
    .from('subscriptions')
    .select()
    .eq('user_id', userId)
    .eq('telegram_chat_id', telegramChatId)
    .eq('is_active', true);
  if (error) throw new Error(`listSubscriptionsForChat failed: ${error.message}`);
  return data ?? [];
}

export async function deleteSubscription(id: string): Promise<void> {
  const { error } = await getSupabase().from('subscriptions').delete().eq('id', id);
  if (error) throw new Error(`deleteSubscription failed: ${error.message}`);
}
