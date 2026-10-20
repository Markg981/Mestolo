'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const schema = z.object({ recipeId: z.uuid(), stars: z.number().int().min(1).max(5).nullable() });

/** Imposta (1-5) o rimuove (null) la valutazione dell'utente. Autorizzazioni e limiti stanno nel DB (RLS + trigger). */
export async function rateRecipe(recipeId: string, stars: number | null): Promise<ActionResult> {
  try {
    const user = await getUser();
    const parsed = schema.safeParse({ recipeId, stars });
    if (!user || !parsed.success) return fail('invalid_input');
    const supabase = await createClient();
    if (parsed.data.stars === null) {
      const { error } = await supabase.from('recipe_ratings').delete().eq('recipe_id', recipeId).eq('user_id', user.id);
      if (error) return dbFailure(error, 'rateRecipe');
    } else {
      // update prima dell'insert: cambiare idea non consuma il limite giornaliero dei nuovi voti
      const { data, error } = await supabase
        .from('recipe_ratings')
        .update({ stars: parsed.data.stars })
        .eq('recipe_id', recipeId)
        .eq('user_id', user.id)
        .select('recipe_id');
      if (error) return dbFailure(error, 'rateRecipe');
      if (!data?.length) {
        const { error: e2 } = await supabase.from('recipe_ratings').insert({ recipe_id: recipeId, user_id: user.id, stars: parsed.data.stars });
        if (e2) return dbFailure(e2, 'rateRecipe');
      }
    }
    revalidatePath(`/recipes/${recipeId}`);
    return ok();
  } catch (e) {
    return toFailure(e, 'rateRecipe');
  }
}
