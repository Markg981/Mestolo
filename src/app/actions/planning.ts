'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { scaleIngredients } from '@/lib/recipes/scale';
import { weekDays, type MealSlot } from '@/lib/plan/week';
import { generatePlan, planCells, type Candidate, type Proposal } from '@/lib/plan/generator';
import { normalizePrefs, prefsFromRow, prefsSchema, prefsToRow, type PrefsRow } from '@/lib/plan/preferences';
import type { Ingredient } from '@/lib/recipes/types';
import { dbFailure, fail, ok, type ActionResult } from './_utils';

const uuid = z.uuid();
// Stessi limiti di recipeSchema.servings: positivo, finito, max 1000.
const servingsSchema = z.number().positive().max(1000).nullable();

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

async function addItems(userId: string, items: NewItem[], targetListId?: string, idempotencyKey?: string): Promise<ActionResult<{ added: number; merged: number }>> {
  const supabase = await createClient();
  let listId: string | null;
  if (targetListId) {
    // RLS: la lista e visibile solo al proprietario e ai membri
    const { data: l } = await supabase.from('shopping_lists').select('id').eq('id', targetListId).maybeSingle();
    listId = (l?.id as string) ?? null;
    if (!listId) return fail('forbidden');
  } else listId = await defaultListId(userId);
  if (!listId) return fail('generic');
  // Merge + insert in un'unica transazione lato DB; la chiave rende il retry/doppio clic innocuo.
  const { data, error } = await supabase.rpc('add_shopping_items', {
    p_list_id: listId,
    p_items: items.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, note: i.note ?? null, recipe_id: i.recipe_id ?? null, recipe_title: i.recipe_title ?? null })),
    p_idempotency_key: idempotencyKey ?? randomUUID(),
  } as never);
  if (error) return dbFailure(error, 'addItems');
  const res = data as unknown as { added: number; merged: number };
  revalidatePath('/shopping');
  return ok({ added: res.added, merged: res.merged });
}

export async function addShoppingItem(input: unknown): Promise<ActionResult<{ added: number; merged: number }>> {
  const user = await getUser();
  const p = itemSchema.extend({ list_id: z.uuid().optional(), idempotency_key: z.uuid().optional() }).safeParse(input);
  if (!user || !p.success) return fail('invalid_input');
  const { list_id, idempotency_key, ...item } = p.data;
  return addItems(user.id, [item], list_id, idempotency_key);
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
export async function addRecipeToShopping(recipeId: string, servings: number | null, indexes?: number[], listId?: string, idempotencyKey?: string): Promise<ActionResult<{ added: number; merged: number }>> {
  const user = await getUser();
  if (!user || !uuid.safeParse(recipeId).success || !servingsSchema.safeParse(servings).success || (listId !== undefined && !uuid.safeParse(listId).success) || (idempotencyKey !== undefined && !uuid.safeParse(idempotencyKey).success)) return fail('invalid_input');
  const supabase = await createClient();
  const { data: r } = await supabase.from('recipes').select('id, title, servings, ingredients').eq('id', recipeId).maybeSingle();
  if (!r) return fail('not_found');
  let ings = (r.ingredients as Ingredient[]) ?? [];
  if (indexes?.length) ings = ings.filter((_, i) => indexes.includes(i));
  if (servings && servings > 0 && r.servings) ings = scaleIngredients(ings, Number(r.servings), servings);
  return addItems(user.id, ingredientsToItems(ings, { id: r.id, title: r.title }), listId, idempotencyKey);
}

export async function toggleShoppingItem(id: string, checked: boolean): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(id).success) return fail('invalid_input');
  const supabase = await createClient();
  const { data, error } = await supabase.from('shopping_items').update({ checked }).eq('id', id).select('id');
  if (error) return dbFailure(error, 'toggleShoppingItem');
  if (!data?.length) return fail('not_found');
  revalidatePath('/shopping');
  return ok();
}

export async function deleteShoppingItem(id: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(id).success) return fail('invalid_input');
  const supabase = await createClient();
  const { data, error } = await supabase.from('shopping_items').delete().eq('id', id).select('id');
  if (error) return dbFailure(error, 'deleteShoppingItem');
  if (!data?.length) return fail('not_found');
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
  const { data, error } = await supabase.from('meal_plan_entries').delete().eq('id', id).select('id');
  if (error) return dbFailure(error, 'deletePlanEntry');
  if (!data?.length) return fail('not_found');
  revalidatePath('/plan');
  return ok();
}

/** Adds the ingredients of every planned recipe in the week to the shopping list. */
export async function addWeekToShopping(weekStart: string, listId?: string, idempotencyKey?: string): Promise<ActionResult<{ added: number; merged: number; recipes: number }>> {
  const user = await getUser();
  if (!user || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || (listId !== undefined && !uuid.safeParse(listId).success) || (idempotencyKey !== undefined && !uuid.safeParse(idempotencyKey).success)) return fail('invalid_input');
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
  const res = await addItems(user.id, items, listId, idempotencyKey);
  if (!res.ok) return res;
  return ok({ ...res.data, recipes: list.length });
}

// ---------- Preferenze e generatore ------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const slotEnum = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);

export async function savePlanPreferences(input: unknown): Promise<ActionResult> {
  const user = await getUser();
  const p = prefsSchema.safeParse(input);
  if (!user || !p.success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('plan_preferences').upsert({ user_id: user.id, ...prefsToRow(normalizePrefs(p.data)) });
  if (error) return dbFailure(error, 'savePlanPreferences');
  revalidatePath('/plan');
  return ok();
}

/** Ricette che l'utente puo' vedere e ha gia' "in mano": sue, preferite o cucinate (RLS decide la visibilita'). */
async function loadCandidates(userId: string): Promise<Candidate[]> {
  const supabase = await createClient();
  const cols = 'id, title, servings, total_minutes, prep_minutes, cook_minutes, category_id, tags, ingredients, rating_avg, rating_count';
  const [{ data: mine }, { data: favs }, { data: logs }, { data: stars }] = await Promise.all([
    supabase.from('recipes').select(cols).eq('owner_id', userId).eq('is_hidden', false).order('updated_at', { ascending: false }).limit(400),
    supabase.from('favorites').select('recipe_id').eq('user_id', userId).limit(300),
    supabase.from('cook_logs').select('recipe_id, cooked_at').eq('user_id', userId).order('cooked_at', { ascending: false }).limit(1000),
    supabase.from('recipe_ratings').select('recipe_id, stars').eq('user_id', userId).limit(1000),
  ]);
  type Row = { id: string; title: string; servings: number | string | null; total_minutes: number | null; prep_minutes: number | null; cook_minutes: number | null; category_id: string | null; tags: string[] | null; ingredients: Ingredient[] | null; rating_avg: number | string | null; rating_count: number | null };
  const rows = new Map<string, Row>(((mine as Row[]) ?? []).map((r) => [r.id, r]));
  const favIds = new Set(((favs as { recipe_id: string }[]) ?? []).map((f) => f.recipe_id));
  const cookLogs = (logs as { recipe_id: string; cooked_at: string }[]) ?? [];
  const extra = [...new Set([...favIds, ...cookLogs.map((l) => l.recipe_id)])].filter((id) => !rows.has(id)).slice(0, 300);
  if (extra.length) {
    const { data } = await supabase.from('recipes').select(cols).in('id', extra).eq('is_hidden', false);
    for (const r of (data as Row[]) ?? []) rows.set(r.id, r);
  }
  const cooked = new Map<string, { count: number; last: number }>();
  for (const l of cookLogs) {
    const t = Date.parse(l.cooked_at);
    const cur = cooked.get(l.recipe_id) ?? { count: 0, last: 0 };
    cooked.set(l.recipe_id, { count: cur.count + 1, last: Math.max(cur.last, t) });
  }
  const myStars = new Map(((stars as { recipe_id: string; stars: number }[]) ?? []).map((r) => [r.recipe_id, r.stars]));
  const now = Date.now();
  return [...rows.values()].map((r) => {
    const c = cooked.get(r.id);
    const minutes = r.total_minutes ?? (r.prep_minutes !== null || r.cook_minutes !== null ? (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0) : null);
    return {
      id: r.id,
      title: r.title,
      totalMinutes: minutes,
      categoryId: r.category_id,
      tags: r.tags ?? [],
      ingredientNames: (r.ingredients ?? []).map((i) => i.name),
      ratingAvg: r.rating_avg === null ? null : Number(r.rating_avg),
      ratingCount: r.rating_count ?? 0,
      myStars: myStars.get(r.id) ?? null,
      favorite: favIds.has(r.id),
      cookedCount: c?.count ?? 0,
      lastCookedDaysAgo: c ? Math.floor((now - c.last) / 86400000) : null,
      servings: r.servings === null ? null : Number(r.servings),
    };
  });
}

const previewSchema = z.object({
  weekStart: isoDate,
  seed: z.number().int().min(0).max(4294967295),
  /** true = considera anche le celle gia' piene (rigenera) */
  replaceFilled: z.boolean().default(false),
  /** rigenera una sola cella */
  cell: z.object({ date: isoDate, slot: slotEnum }).optional(),
  /** altre proposte dell'anteprima, per la varieta' */
  keep: z.array(z.object({ date: isoDate, slot: slotEnum, recipeId: z.uuid() })).max(60).default([]),
  excludeRecipeIds: z.array(z.uuid()).max(60).default([]),
});

/** Calcola un'anteprima del piano SENZA salvare nulla. */
export async function previewPlan(input: unknown): Promise<ActionResult<{ proposals: Proposal[] }>> {
  const user = await getUser();
  const p = previewSchema.safeParse(input);
  if (!user || !p.success) return fail('invalid_input');
  const days = weekDays(p.data.weekStart);
  if (p.data.cell && !days.includes(p.data.cell.date)) return fail('invalid_input');
  const supabase = await createClient();
  const [{ data: prefsRow }, { data: entries }, candidates] = await Promise.all([
    supabase.from('plan_preferences').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('meal_plan_entries').select('plan_date, slot, recipe_id').eq('owner_id', user.id).gte('plan_date', days[0]).lte('plan_date', days[6]),
    loadCandidates(user.id),
  ]);
  const prefs = prefsFromRow(prefsRow as PrefsRow | null);
  const filled = (entries as { plan_date: string; slot: MealSlot; recipe_id: string | null }[]) ?? [];
  const byRecipe = new Map(candidates.map((c) => [c.id, c]));
  const key = (c: { date: string; slot: string }) => `${c.date}|${c.slot}`;
  const cells = p.data.cell
    ? [p.data.cell]
    : planCells(days, prefs).filter((c) => (p.data.replaceFilled || !filled.some((e) => e.plan_date === c.date && e.slot === c.slot)));
  const regenerated = new Set(cells.map(key));
  const existing = [
    ...filled.filter((e) => e.recipe_id && !regenerated.has(`${e.plan_date}|${e.slot}`)).map((e) => ({ cell: { date: e.plan_date, slot: e.slot }, recipeId: e.recipe_id as string, categoryId: byRecipe.get(e.recipe_id as string)?.categoryId ?? null })),
    ...p.data.keep.filter((k) => !regenerated.has(key(k))).map((k) => ({ cell: { date: k.date, slot: k.slot }, recipeId: k.recipeId, categoryId: byRecipe.get(k.recipeId)?.categoryId ?? null })),
  ];
  const proposals = generatePlan({ candidates, prefs, cells, existing, seed: p.data.seed, excludeRecipeIds: p.data.excludeRecipeIds });
  return ok({ proposals });
}

const applySchema = z.object({
  weekStart: isoDate,
  replaceFilled: z.boolean().default(false),
  proposals: z.array(z.object({ date: isoDate, slot: slotEnum, recipeId: z.uuid(), servings: z.number().positive().max(1000).nullable() })).min(1).max(28),
});

/** Salva l'anteprima. Senza replaceFilled non tocca mai gli slot gia' pieni. */
export async function applyPlan(input: unknown): Promise<ActionResult<{ saved: number; skipped: number }>> {
  const user = await getUser();
  const p = applySchema.safeParse(input);
  if (!user || !p.success) return fail('invalid_input');
  const days = weekDays(p.data.weekStart);
  const cellKeys = new Set<string>();
  const list = p.data.proposals.filter((x) => {
    const k = `${x.date}|${x.slot}`;
    if (!days.includes(x.date) || cellKeys.has(k)) return false;
    cellKeys.add(k);
    return true;
  });
  const supabase = await createClient();
  const { data: existing } = await supabase.from('meal_plan_entries').select('id, plan_date, slot').eq('owner_id', user.id).gte('plan_date', days[0]).lte('plan_date', days[6]);
  const taken = (existing as { id: string; plan_date: string; slot: string }[]) ?? [];
  const isTaken = (x: { date: string; slot: string }) => taken.some((e) => e.plan_date === x.date && e.slot === x.slot);
  const todo = p.data.replaceFilled ? list : list.filter((x) => !isTaken(x));
  if (!todo.length) return ok({ saved: 0, skipped: list.length });
  const { data: recipes } = await supabase.from('recipes').select('id, title').in('id', [...new Set(todo.map((x) => x.recipeId))]);
  const titles = new Map(((recipes as { id: string; title: string }[]) ?? []).map((r) => [r.id, r.title]));
  const rows = todo.filter((x) => titles.has(x.recipeId)).map((x) => ({ owner_id: user.id, plan_date: x.date, slot: x.slot, recipe_id: x.recipeId, title: titles.get(x.recipeId) as string, servings: x.servings }));
  if (p.data.replaceFilled && rows.length) {
    // Cancellazione + inserimento nella stessa transazione: se l'inserimento fallisce il piano resta intatto.
    const { error } = await supabase.rpc('replace_plan_entries', { p_rows: rows.map((r) => ({ plan_date: r.plan_date, slot: r.slot, recipe_id: r.recipe_id, title: r.title, servings: r.servings })) } as never);
    if (error) return dbFailure(error, 'applyPlan.replace');
  } else if (rows.length) {
    const { error } = await supabase.from('meal_plan_entries').insert(rows);
    if (error) return dbFailure(error, 'applyPlan.insert');
  }
  revalidatePath('/plan');
  return ok({ saved: rows.length, skipped: list.length - rows.length });
}

const moveSchema = z.union([
  z.object({ id: z.uuid(), plan_date: isoDate, slot: slotEnum }),
  z.object({ id: z.uuid(), swap_with: z.uuid() }),
]);

/** Sposta una voce in un'altra cella oppure la scambia con un'altra voce (atomico, azzera il promemoria inviato). */
export async function movePlanEntry(input: unknown): Promise<ActionResult> {
  const user = await getUser();
  const p = moveSchema.safeParse(input);
  if (!user || !p.success) return fail('invalid_input');
  const supabase = await createClient();
  const args = 'swap_with' in p.data ? { p_entry: p.data.id, p_date: null, p_slot: null, p_swap_with: p.data.swap_with } : { p_entry: p.data.id, p_date: p.data.plan_date, p_slot: p.data.slot, p_swap_with: null };
  const { error } = await supabase.rpc('move_plan_entry', args as never);
  if (error) return dbFailure(error, 'movePlanEntry');
  revalidatePath('/plan');
  return ok();
}
