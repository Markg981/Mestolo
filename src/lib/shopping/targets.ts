import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { resolveShoppingList } from './data';

export interface ListOption {
  id: string;
  label: string;
}

/**
 * Liste in cui l'utente puo aggiungere prodotti (proprie + condivise, via RLS).
 * Restituisce l'elenco solo se ce n'e piu di una: altrimenti il selettore non serve.
 */
export async function loadListOptions(userId: string): Promise<ListOption[]> {
  const resolved = await resolveShoppingList(userId);
  if (!resolved || resolved.lists.length < 2) return [];
  const t = await getTranslations('shopping');
  const supabase = await createClient();
  const ownerIds = [...new Set(resolved.lists.filter((l) => l.owner_id !== userId).map((l) => l.owner_id))];
  const { data } = ownerIds.length ? await supabase.from('profiles').select('id, username, display_name').in('id', ownerIds) : { data: [] };
  const names = new Map(((data as { id: string; username: string; display_name: string }[]) ?? []).map((p) => [p.id, p.display_name || p.username]));
  // La lista propria per prima, come default del selettore.
  const own = resolved.lists.filter((l) => l.owner_id === userId);
  const others = resolved.lists.filter((l) => l.owner_id !== userId);
  return [...own, ...others].map((l) => ({
    id: l.id,
    label: l.owner_id === userId ? (l.name === 'default' ? t('defaultName') : l.name) : t('sharedBy', { name: names.get(l.owner_id) ?? '?' }),
  }));
}
