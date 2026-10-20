'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { AISLES, normalizeName } from '@/lib/shopping/aisles';
import { dbFailure, fail, ok, type ActionResult } from './_utils';

const uuid = z.uuid();

/** Salva (o, con aisle null, ripristina l'automatico) il reparto di un prodotto per la lista. */
export async function setItemAisle(listId: string, name: string, aisle: string | null): Promise<ActionResult> {
  const user = await getUser();
  const key = normalizeName(String(name ?? ''));
  if (!user || !uuid.safeParse(listId).success || !key) return fail('invalid_input');
  const supabase = await createClient();
  if (aisle === null) {
    const { error } = await supabase.from('shopping_aisle_overrides').delete().eq('list_id', listId).eq('name_key', key);
    if (error) return dbFailure(error, 'setItemAisle');
  } else {
    if (!(AISLES as readonly string[]).includes(aisle)) return fail('invalid_input');
    const { error } = await supabase
      .from('shopping_aisle_overrides')
      .upsert({ list_id: listId, name_key: key, aisle, set_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'list_id,name_key' });
    if (error) return dbFailure(error, 'setItemAisle');
  }
  revalidatePath('/shopping');
  return ok();
}

/** Solo il proprietario (RLS): invita un amico non bloccato. */
export async function addShoppingMember(listId: string, userId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(listId).success || !uuid.safeParse(userId).success || userId === user.id) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('shopping_list_members').insert({ list_id: listId, user_id: userId, added_by: user.id });
  if (error) {
    if (error.code === '23505') return ok();
    return dbFailure(error, 'addShoppingMember');
  }
  revalidatePath('/shopping');
  return ok();
}

/** Il proprietario rimuove un membro; il membro rimuove se stesso (uscita). */
export async function removeShoppingMember(listId: string, userId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(listId).success || !uuid.safeParse(userId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('shopping_list_members').delete().eq('list_id', listId).eq('user_id', userId);
  if (error) return dbFailure(error, 'removeShoppingMember');
  revalidatePath('/shopping');
  return ok();
}

export async function renameShoppingList(listId: string, name: string): Promise<ActionResult> {
  const user = await getUser();
  const n = z.string().trim().min(1).max(80).safeParse(name);
  if (!user || !uuid.safeParse(listId).success || !n.success) return fail('invalid_input');
  const supabase = await createClient();
  const { data, error } = await supabase.from('shopping_lists').update({ name: n.data }).eq('id', listId).eq('owner_id', user.id).select('id');
  if (error) return dbFailure(error, 'renameShoppingList');
  if (!data?.length) return fail('forbidden');
  revalidatePath('/shopping');
  return ok();
}
