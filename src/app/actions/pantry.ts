'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { dbFailure, fail, ok, type ActionResult } from './_utils';

const uuid = z.uuid();

const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().nonnegative().max(1000000).nullable().default(null),
  unit: z.string().trim().max(40).nullable().default(null),
  expires_on: z.iso.date().nullable().default(null),
  location: z.enum(['fridge', 'freezer', 'pantry']).default('pantry'),
  note: z.string().trim().max(300).nullable().default(null),
});

export async function addPantryItem(input: unknown): Promise<ActionResult> {
  const user = await getUser();
  const p = itemSchema.safeParse(input);
  if (!user || !p.success) return fail('invalid_input');
  const supabase = await createClient();
  // Upsert/merge lato DB: stesso nome normalizzato + stessa unita => quantita sommata.
  const { error } = await supabase.rpc('add_pantry_item', {
    p_name: p.data.name,
    p_quantity: p.data.quantity,
    p_unit: p.data.unit || null,
    p_expires_on: p.data.expires_on,
    p_location: p.data.location,
    p_note: p.data.note || null,
  });
  if (error) return dbFailure(error, 'addPantryItem');
  revalidatePath('/pantry');
  return ok();
}

export async function updatePantryItem(id: string, input: unknown): Promise<ActionResult> {
  const user = await getUser();
  const p = itemSchema.safeParse(input);
  if (!user || !uuid.safeParse(id).success || !p.success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase
    .from('pantry_items')
    .update({ ...p.data, unit: p.data.unit || null, note: p.data.note || null })
    .eq('id', id)
    .eq('owner_id', user.id);
  if (error) return dbFailure(error, 'updatePantryItem');
  revalidatePath('/pantry');
  return ok();
}

export async function deletePantryItem(id: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(id).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('pantry_items').delete().eq('id', id).eq('owner_id', user.id);
  if (error) return dbFailure(error, 'deletePantryItem');
  revalidatePath('/pantry');
  return ok();
}
