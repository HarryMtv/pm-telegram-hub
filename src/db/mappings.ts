import { getSupabase, MappingRow } from './client.js';

export interface NewMapping {
  userId: string;
  provider: string;
  alias: string;
  containerId: string;
  containerMeta?: Record<string, unknown>;
  isDefault?: boolean;
}

export async function upsertMapping(input: NewMapping): Promise<MappingRow> {
  const { data, error } = await getSupabase()
    .from('mappings')
    .upsert(
      {
        user_id: input.userId,
        provider: input.provider,
        alias: input.alias,
        container_id: input.containerId,
        container_meta: input.containerMeta ?? {},
        is_default: input.isDefault ?? false,
      },
      { onConflict: 'user_id,provider,alias' },
    )
    .select()
    .single();
  if (error || !data) throw new Error(`upsertMapping failed: ${error?.message ?? 'no row'}`);
  return data;
}

export async function getMappingByAlias(
  userId: string,
  provider: string,
  alias: string,
): Promise<MappingRow | null> {
  const { data, error } = await getSupabase()
    .from('mappings')
    .select()
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('alias', alias)
    .maybeSingle();
  if (error) throw new Error(`getMappingByAlias failed: ${error.message}`);
  return data;
}

export async function getDefaultMapping(
  userId: string,
  provider: string,
): Promise<MappingRow | null> {
  const { data, error } = await getSupabase()
    .from('mappings')
    .select()
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('is_default', true)
    .maybeSingle();
  if (error) throw new Error(`getDefaultMapping failed: ${error.message}`);
  return data;
}

export async function listMappingsForUser(userId: string): Promise<MappingRow[]> {
  const { data, error } = await getSupabase()
    .from('mappings')
    .select()
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listMappingsForUser failed: ${error.message}`);
  return data ?? [];
}
