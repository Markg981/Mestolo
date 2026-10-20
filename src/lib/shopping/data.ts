import { createClient } from '@/lib/supabase/server';
import { isAisle, type Aisle } from './aisles';

export interface ListInfo {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface RawItem {
  id: string;
  name: string;
  quantity: number | string | null;
  unit: string | null;
  note: string | null;
  checked: boolean;
  recipe_id: string | null;
  recipe_title: string | null;
  owner_id: string;
  checked_by: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Liste visibili all'utente (proprie + condivise, via RLS) e lista selezionata.
 * Senza richiesta valida si usa la lista propria (creata se manca).
 */
export async function resolveShoppingList(userId: string, requested?: string | null): Promise<{ lists: ListInfo[]; selected: ListInfo } | null> {
  const supabase = await createClient();
  const load = async () => {
    const { data } = await supabase.from('shopping_lists').select('id, name, owner_id, created_at').order('created_at');
    return (data as ListInfo[]) ?? [];
  };
  let lists = await load();
  if (!lists.some((l) => l.owner_id === userId)) {
    await supabase.from('shopping_lists').insert({ owner_id: userId, name: 'default' });
    lists = await load();
  }
  const own = lists.find((l) => l.owner_id === userId);
  const wanted = requested && UUID_RE.test(requested) ? lists.find((l) => l.id === requested) : undefined;
  const selected = wanted ?? own ?? lists[0];
  return selected ? { lists, selected } : null;
}

export async function loadAisleOverrides(listId: string): Promise<Record<string, Aisle>> {
  const supabase = await createClient();
  const { data } = await supabase.from('shopping_aisle_overrides').select('name_key, aisle').eq('list_id', listId);
  const out: Record<string, Aisle> = {};
  for (const r of (data as { name_key: string; aisle: string }[]) ?? []) if (isAisle(r.aisle)) out[r.name_key] = r.aisle;
  return out;
}

export async function loadItems(listId: string): Promise<RawItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('shopping_items')
    .select('id, name, quantity, unit, note, checked, recipe_id, recipe_title, owner_id, checked_by, created_at')
    .eq('list_id', listId)
    .order('checked')
    .order('created_at');
  return (data as RawItem[]) ?? [];
}
