'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { planShoppingMerge } from '@/lib/shopping/merge';
import { scaleIngredients } from '@/lib/recipes/scale';
import { weekDays } from '@/lib/plan/week';
import type { Ingredient } from '@/lib/recipes/types';
import { dbFailure, fail, ok, type ActionResult } from './_utils';

const uuid = z.uuid();

async function defaultListId(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('shopping_lists').select('id').eq('owner_id', userId).order('created_at').limit(1).maybeSingle();
  if (data) return data.id as string;
  const { data: created } = await supabase.from('shopping_lists').insert({ owner_id: userId, name: 'default' }).select('id').single();
  return (created?.id as string) ?? null;
}

const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().nonnegative().max(1000000).nullable().default(null),
  unit: z.string().trim().max(40).nullable().default(null),
  note: z.string().trim().max(300).nullable().default(null),
});

type NewItem = z.infer<typeof itemSchema> & { recipe_id?: string | null; recipe_title?: string | null };

async function addItems(userId: string, items: NewItem[], targetListId?: string): Promise<ActionResult<{ added: number; merged: number }>> {
  const supabase = await createClient();
  let listId: string | null;
  if (targetListId) {
    // RLS: la lista e visibile solo al proprietario e ai membri
    const { data: l } = await supabase.from('shopping_lists').select('id').eq('id', targetListId).maybeSingle();
    listId = (l?.id as string) ?? null;
    if (!listId) return fail('forbidden');
  } else listId = await defaultListId(userId);
  if (!listId) return fail('generic');
  const { data: existing } = await supabase.from('shopping_items').select('id, name, quantity, unit, checked').eq('list_id', listId);
  const plan = planShoppingMerge(
    ((existing as { id: string; name: string; quantity: number | null; unit: string | null; checked: boolean }[]) ?? []).map((e) => ({
      ...e,
      quantity: e.quantity === null ? null : Number(e.quantity),
    })),
    items,
  );
  for (const u of plan.updates) {
    await supabase.from('shopping_items').update({ quantity: u.quantity }).eq('id', u.id);
  }
  if (plan.inserts.length) {
    const { error } = await supabase.from('shopping_items').insert(
      plan.inserts.map((i, idx) => ({
        list_id: listId,
        owner_id: userId,
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        note: i.note ?? null,
        recipe_id: i.recipe_id ?? null,
        recipe_title: i.recipe_title ?? null,
        position: idx,
      })),
    );
    if (error) return dbFailure(error, 'addItems');
  }
  revalidatePath('/shopping');
  return ok({ added: plan.inserts.length, merged: plan.updates.length });
}

export async function addShoppingItem(input: unknown): Promise<ActionResult<{ added: number; merged: number }>> {
  const user = await getUser();
  const p = itemSchema.extend({ list_id: z.uuid().optional() }).safeParse(input);
  if (!user || !p.success) return fail('invalid_input');
  const { list_id, ...item } = p.data;
  return addItems(user.id, [item], list_id);
}

function ingredientsToItems(ings: Ingredient[], recipe: { id: string; title: string }): NewItem[] {
  return ings.map((i) => ({
    name: i.name,
    quantity: i.quantity,
    unit: i.unit,
    note: i.toTaste ? 'q.b.' : null,
    recipe_id: recipe.id,
    recipe_title: recipe.title,
  }));
}

/** Adds (a selection of) a recipe's ingredients, scaled to the chosen servings. */
export async function addRecipeToShopping(recipeId: string, servings: number | null, indexes?: number[]): Promise<ActionResult<{ added: number; merged: number }>> {
  const user = await getUser();
  if (!user || !uuid.safeParse(recipeId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { data: r } = await supabase.from('recipes').select('id, title, servings, ingredients').eq('id', recipeId).maybeSingle();
  if (!r) return fail('not_found');
  let ings = (r.ingredients as Ingredient[]) ?? [];
  if (indexes?.length) ings = ings.filter((_, i) => indexes.includes(i));
  if (servings && servings > 0 && r.servings) ings = scaleIngredients(ings, Number(r.servings), servings);
  return addItems(user.id, ingredientsToItems(ings, { id: r.id, title: r.title }));
}

export async function toggleShoppingItem(id: string, checked: boolean): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(id).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('shopping_items').update({ checked }).eq('id', id);
  if (error) return dbFailure(error, 'toggleShoppingItem');
  revalidatePath('/shopping');
  return ok();
}

export async function deleteShoppingItem(id: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(id).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('shopping_items').delete().eq('id', id);
  if (error) return dbFailure(error, 'deleteShoppingItem');
  revalidatePath('/shopping');
  return ok();
}

export async function clearCheckedItems(listId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(listId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('shopping_items').delete().eq('list_id', listId).eq('checked', true);
  if (error) return dbFailure(error, 'clearCheckedItems');
  revalidatePath('/shopping');
  return ok();
}

const entrySchema = z.object({
  plan_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  recipe_id: z.uuid().nullable().default(null),
  title: z.string().trim().max(200).default(''),
  servings: z.number().positive().max(1000).nullable().default(null),
});

export async function addPlanEntry(input: unknown): Promise<ActionResult> {
  const user = await getUser();
  const p = entrySchema.safeParse(input);
  if (!user || !p.success) return fail('invalid_input');
  const supabase = await createClient();
  let title = p.data.title;
  if (p.data.recipe_id) {
    const { data: r } = await supabase.from('recipes').select('title').eq('id', p.data.recipe_id).maybeSingle();
    if (!r) return fail('not_found');
    title = r.title;
  }
  if (!title) return fail('invalid_input');
  const { error } = await supabase.from('meal_plan_entries').insert({ ...p.data, title, owner_id: user.id });
  if (error) return dbFailure(error, 'addPlanEntry');
  revalidatePath('/plan');
  return ok();
}

export async function deletePlanEntry(id: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(id).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('meal_plan_entries').delete().eq('id', id);
  if (error) return dbFailure(error, 'deletePlanEntry');
  revalidatePath('/plan');
  return ok();
}

/** Adds the ingredients of every planned recipe in the week to the shopping list. */
export async function addWeekToShopping(weekStart: string): Promise<ActionResult<{ added: number; merged: number; recipes: number }>> {
  const user = await getUser();
  if (!user || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return fail('invalid_input');
  const days = weekDays(weekStart);
  const supabase = await createClient();
  const { data: entries } = await supabase
    .from('meal_plan_entries')
    .select('recipe_id, servings')
    .eq('owner_id', user.id)
    .gte('plan_date', days[0])
    .lte('plan_date', days[6])
    .not('recipe_id', 'is', null);
  const list = (entries as { recipe_id: string; servings: number | null }[]) ?? [];
  if (!list.length) return ok({ added: 0, merged: 0, recipes: 0 });
  const { data: recipes } = await supabase.from('recipes').select('id, title, servings, ingredients').in('id', [...new Set(list.map((e) => e.recipe_id))]);
  const byId = new Map(((recipes as { id: string; title: string; servings: number | null; ingredients: Ingredient[] }[]) ?? []).map((r) => [r.id, r]));
  const items: NewItem[] = [];
  for (const e of list) {
    const r = byId.get(e.recipe_id);
    if (!r) continue;
    const ings = e.servings && r.servings ? scaleIngredients(r.ingredients ?? [], Number(r.servings), Number(e.servings)) : r.ingredients ?? [];
    items.push(...ingredientsToItems(ings, r));
  }
  const res = await addItems(user.id, items);
  if (!res.ok) return res;
  return ok({ ...res.data, recipes: list.length });
}
