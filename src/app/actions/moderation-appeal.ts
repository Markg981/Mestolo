'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { dbFailure, fail, ok, type ActionResult } from './_utils';

/** The author asks for a new review of a recipe hidden by moderation (one appeal per case, enforced in the database). */
export async function appealModeration(recipeId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !z.uuid().safeParse(recipeId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.rpc('appeal_moderation', { p_recipe: recipeId });
  if (error) return error.code === '42501' ? fail('forbidden') : error.code === '22023' ? fail('invalid_input') : dbFailure(error, 'appealModeration');
  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath('/moderation');
  return ok();
}
