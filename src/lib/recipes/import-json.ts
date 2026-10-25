import { z } from 'zod';
import { MESTOLO_FORMAT } from './export';
import { ingredientSchema, LOCALE_RE, RECIPE_LIMITS, stepSchema } from './schema';
import { SYSTEM_CATEGORY_SLUGS } from './categories';
import { suggestCategory } from './classify';
import { knownDiets } from './diets';
import type { FieldFlags, ImportDraft, Ingredient, Step } from './types';

/**
 * Import of files produced by Mestolo's own export (docs/export-format.md):
 *  - "mestolo.recipe/v1": one recipe
 *  - "mestolo.account-export/v1": every recipe of an account (raw rows)
 * Runs in the browser: the result is a draft that the user reviews and saves like any other import,
 * so the server validates it again. Ids, owners, versions and visibility are never carried over.
 */
export const ACCOUNT_EXPORT_FORMAT = 'mestolo.account-export/v1';
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_RECIPES = 2000;

export type JsonImportError = 'invalid_json' | 'unsupported_format' | 'no_recipes';
export type JsonImportResult = { ok: true; drafts: ImportDraft[]; skipped: number } | { ok: false; error: JsonImportError };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optStr = (v: unknown, max: number) => str(v, max) || null;

const minutes = z.number().int().min(0).max(100000);
const mins = (v: unknown) => (minutes.safeParse(v).success ? (v as number) : null);
const servings = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1000 ? n : null;
};
const flagSchema = z.array(z.enum(['missing', 'low_confidence', 'ambiguous', 'ai_estimate'])).max(4);

function list<T>(v: unknown, schema: z.ZodType<T>, max: number): { items: T[]; dropped: number } {
  if (!Array.isArray(v)) return { items: [], dropped: 0 };
  const items: T[] = [];
  let dropped = 0;
  for (const x of v.slice(0, max)) {
    const p = schema.safeParse(x);
    if (p.success) items.push(p.data);
    else dropped++;
  }
  return { items, dropped: dropped + Math.max(0, v.length - max) };
}

function fieldFlags(v: unknown): FieldFlags {
  if (!isObj(v)) return {};
  const out: FieldFlags = {};
  for (const [k, f] of Object.entries(v).slice(0, 500)) {
    const p = flagSchema.safeParse(f);
    if (p.success && p.data.length && k.length <= 100) out[k] = p.data;
  }
  return out;
}

function tags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const t = v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase().slice(0, 40)).filter(Boolean);
  return [...new Set(t)].slice(0, 30);
}

const isSystemSlug = (s: unknown): s is string => typeof s === 'string' && (SYSTEM_CATEGORY_SLUGS as readonly string[]).includes(s);

/** Builds a review draft from one exported recipe (either the v1 shape or an account-export row). */
export function draftFromExportedRecipe(r: Obj, categorySlug: string | null): ImportDraft | null {
  const title = str(r.title, RECIPE_LIMITS.title);
  if (!title) return null;
  const ing = list<Ingredient>(r.ingredients, ingredientSchema as z.ZodType<Ingredient>, 200);
  const st = list<Step>(r.steps, stepSchema as z.ZodType<Step>, 200);
  const description = str(r.description, RECIPE_LIMITS.description);
  const t = tags(r.tags);

  const src = isObj(r.source) ? r.source : { url: r.source_url, name: r.source_name, attribution: r.source_attribution };
  const rawUrl = str(src.url, 2000);
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : null;

  const slug = isSystemSlug(categorySlug) ? categorySlug : null;
  const cat = slug ? { slug, confidence: 1 } : suggestCategory({ title, description, tags: t, ingredients: ing.items });

  const warnings: ImportDraft['warnings'] = [];
  if (ing.dropped || st.dropped) warnings.push({ code: 'partial_content' });
  if (!ing.items.length) warnings.push({ code: 'no_ingredients' });
  if (!st.items.length) warnings.push({ code: 'no_steps' });

  const lang = str(r.original_language, 10);
  const note = typeof r.personal_note === 'string' ? r.personal_note.slice(0, RECIPE_LIMITS.personalNote) : '';
  const hints = Array.isArray(r.diet_hints_unverified) ? r.diet_hints_unverified : Array.isArray(r.diet_hints) ? r.diet_hints : [];

  return {
    content: {
      title,
      description,
      original_language: LOCALE_RE.test(lang) ? lang : 'it',
      servings: servings(r.servings),
      prep_minutes: mins(r.prep_minutes),
      cook_minutes: mins(r.cook_minutes),
      total_minutes: mins(r.total_minutes),
      ingredients: ing.items,
      steps: st.items,
      tags: t,
      category_slug: cat.slug,
    },
    field_flags: fieldFlags(r.field_flags),
    warnings,
    categoryConfidence: cat.confidence,
    source: {
      type: url ? 'url' : 'text',
      url,
      name: optStr(src.name, 200),
      attribution: optStr(src.attribution, 500) ?? optStr(src.original_author_name ?? r.original_author_name, 500),
      method: 'file',
    },
    diet_hints: knownDiets(hints),
    personal_note: note || undefined,
  };
}

export function parseMestoloExport(text: string): JsonImportResult {
  let root: unknown;
  try {
    root = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (!isObj(root)) return { ok: false, error: 'unsupported_format' };

  if (root.format === MESTOLO_FORMAT) {
    const r = root.recipe;
    if (!isObj(r)) return { ok: false, error: 'no_recipes' };
    const draft = draftFromExportedRecipe(r, isObj(r.category) ? (r.category.slug as string | null) : null);
    return draft ? { ok: true, drafts: [draft], skipped: 0 } : { ok: false, error: 'no_recipes' };
  }

  if (root.format === ACCOUNT_EXPORT_FORMAT) {
    const rows = Array.isArray(root.recipes) ? root.recipes.filter(isObj) : [];
    const catSlug = new Map<string, string>();
    for (const c of Array.isArray(root.custom_categories) ? root.custom_categories.filter(isObj) : Array.isArray(root.categories) ? root.categories.filter(isObj) : []) {
      if (typeof c.id === 'string' && typeof c.slug === 'string') catSlug.set(c.id, c.slug);
    }
    const notes = new Map<string, string>();
    for (const n of Array.isArray(root.personal_notes) ? root.personal_notes.filter(isObj) : Array.isArray(root.recipe_notes) ? root.recipe_notes.filter(isObj) : []) {
      if (typeof n.recipe_id === 'string' && typeof n.body === 'string') notes.set(n.recipe_id, n.body);
    }
    const drafts: ImportDraft[] = [];
    for (const row of rows.slice(0, MAX_IMPORT_RECIPES)) {
      const id = typeof row.id === 'string' ? row.id : '';
      const d = draftFromExportedRecipe({ ...row, personal_note: notes.get(id) }, catSlug.get(String(row.category_id)) ?? null);
      if (d) drafts.push(d);
    }
    if (!drafts.length) return { ok: false, error: 'no_recipes' };
    return { ok: true, drafts, skipped: rows.length - drafts.length };
  }

  return { ok: false, error: 'unsupported_format' };
}
