import { getSupabase, UserRow } from './client.js';

export interface TelegramIdentity {
  telegramId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/** Create the user row on first contact, or refresh display fields; returns the row. */
export async function upsertUserByTelegram(identity: TelegramIdentity): Promise<UserRow> {
  const { data, error } = await getSupabase()
    .from('users')
    .upsert(
      {
        telegram_id: identity.telegramId,
        telegram_username: identity.username ?? null,
        first_name: identity.firstName ?? null,
        last_name: identity.lastName ?? null,
      },
      { onConflict: 'telegram_id' },
    )
    .select()
    .single();

  if (error || !data) throw new Error(`upsertUserByTelegram failed: ${error?.message ?? 'no row'}`);
  return data;
}

export async function getUserByTelegramId(telegramId: number): Promise<UserRow | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select()
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (error) throw new Error(`getUserByTelegramId failed: ${error.message}`);
  return data;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const { data, error } = await getSupabase().from('users').select().eq('id', id).maybeSingle();
  if (error) throw new Error(`getUserById failed: ${error.message}`);
  return data;
}
