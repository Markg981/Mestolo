import { normalizeUnit } from '@/lib/recipes/units';
import { knownDiets } from '@/lib/recipes/diets';
import type { FieldFlags, ImportDraft, Ingredient, RecipeRow, Step } from '@/lib/recipes/types';
import type { EditorCategory, EditorIngredient, EditorState, EditorStep } from './types';

let counter = 0;
export const newKey = () => `k${Date.now().toString(36)}${(counter++).toString(36)}`;

const numStr = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

export function toEditorIngredient(i: Ingredient, unitLabel: (key: string) => string): EditorIngredient {
  return {
    key: newKey(),
    name: i.name,
    quantity: numStr(i.quantity),
    quantityMax: numStr(i.quantityMax),
    unit: i.unit ? unitLabel(i.unit) : '',
    note: i.note ?? '',
    section: i.section ?? null,
    toTaste: !!i.toTaste,
    raw: i.raw ?? null,
    flags: i.flags ?? [],
  };
}

export function toEditorStep(s: Step): EditorStep {
  return { key: newKey(), text: s.text, section: s.section ?? null, flags: s.flags ?? [] };
}

export function emptyIngredient(): EditorIngredient {
  return { key: newKey(), name: '', quantity: '', quantityMax: '', unit: '', note: '', section: null, toTaste: false, raw: null, flags: [] };
}

export function emptyStep(): EditorStep {
  return { key: newKey(), text: '', section: null, flags: [] };
}

export function stateFromRecipe(r: RecipeRow, note: string, unitLabel: (key: string) => string): EditorState {
  return {
    title: r.title,
    description: r.description,
    original_language: r.original_language,
    servings: numStr(r.servings === null ? null : Number(r.servings)),
    prep_minutes: numStr(r.prep_minutes),
    cook_minutes: numStr(r.cook_minutes),
    total_minutes: numStr(r.total_minutes),
    ingredients: (r.ingredients ?? []).map((i) => toEditorIngredient(i, unitLabel)),
    steps: (r.steps ?? []).map(toEditorStep),
    category_id: r.category_id ?? '',
    tags: (r.tags ?? []).join(', '),
    visibility: r.visibility,
    personal_note: note,
    field_flags: r.field_flags ?? {},
    diet_hints: knownDiets(r.diet_hints),
  };
}

export function stateFromDraft(d: ImportDraft, categories: EditorCategory[], unitLabel: (key: string) => string): EditorState {
  const c = d.content;
  const cat = categories.find((x) => x.system && x.slug === c.category_slug) ?? categories.find((x) => x.slug === 'uncategorized');
  return {
    title: c.title,
    description: c.description,
    original_language: c.original_language,
    servings: numStr(c.servings),
    prep_minutes: numStr(c.prep_minutes),
    cook_minutes: numStr(c.cook_minutes),
    total_minutes: numStr(c.total_minutes),
    ingredients: c.ingredients.length ? c.ingredients.map((i) => toEditorIngredient(i, unitLabel)) : [emptyIngredient()],
    steps: c.steps.length ? c.steps.map(toEditorStep) : [emptyStep()],
    category_id: cat?.id ?? '',
    tags: c.tags.join(', '),
    visibility: 'private',
    personal_note: d.personal_note ?? '',
    field_flags: d.field_flags,
    diet_hints: knownDiets(d.diet_hints),
  };
}

export function emptyState(locale: string): EditorState {
  return {
    title: '',
    description: '',
    original_language: locale,
    servings: '',
    prep_minutes: '',
    cook_minutes: '',
    total_minutes: '',
    ingredients: [emptyIngredient(), emptyIngredient(), emptyIngredient()],
    steps: [emptyStep(), emptyStep()],
    category_id: '',
    tags: '',
    visibility: 'private',
    personal_note: '',
    field_flags: {},
    diet_hints: [],
  };
}

function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac && Number(frac[2])) return Number(frac[1]) / Number(frac[2]);
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseInt0(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Math.round(Number(t.replace(',', '.')));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Converts editor state to the server payload. Unknown units are kept as typed (never guessed). */
export function toPayload(s: EditorState, labelToUnit: Map<string, string>, opts: { verified: boolean; review: boolean }) {
  const strip = (flags: FieldFlags): FieldFlags => {
    if (!opts.verified) return flags;
    const out: FieldFlags = {};
    for (const [k, v] of Object.entries(flags)) {
      const keep = v.filter((f) => f === 'ai_estimate');
      if (keep.length) out[k] = keep;
    }
    return out;
  };
  const ingredients = s.ingredients
    .filter((i) => i.name.trim())
    .map((i) => {
      const unitText = i.unit.trim();
      const unit = unitText ? labelToUnit.get(unitText.toLowerCase()) ?? normalizeUnit(unitText) ?? unitText : null;
      const quantity = i.toTaste ? null : parseNum(i.quantity);
      const quantityMax = quantity !== null ? parseNum(i.quantityMax) : null;
      let flags = opts.verified ? i.flags.filter((f) => f === 'ai_estimate') : i.flags;
      if (quantity !== null || i.toTaste) flags = flags.filter((f) => f !== 'missing');
      return {
        name: i.name.trim(),
        quantity,
        quantityMax: quantityMax && quantity !== null && quantityMax > quantity ? quantityMax : null,
        unit,
        note: i.note.trim() || null,
        section: i.section,
        toTaste: i.toTaste || undefined,
        raw: i.raw,
        flags: flags.length ? flags : undefined,
      };
    });
  const steps = s.steps
    .filter((x) => x.text.trim())
    .map((x) => {
      const flags = opts.verified ? x.flags.filter((f) => f === 'ai_estimate') : x.flags;
      return { text: x.text.trim(), section: x.section, flags: flags.length ? flags : undefined };
    });
  const field_flags = strip(s.field_flags);
  const anyFlags =
    Object.values(field_flags).some((v) => v.some((f) => f !== 'ai_estimate')) ||
    ingredients.some((i) => i.flags?.some((f) => f !== 'ai_estimate')) ||
    steps.some((x) => x.flags?.some((f) => f !== 'ai_estimate'));
  return {
    title: s.title.trim(),
    description: s.description.trim(),
    original_language: s.original_language,
    servings: parseNum(s.servings),
    prep_minutes: parseInt0(s.prep_minutes),
    cook_minutes: parseInt0(s.cook_minutes),
    total_minutes: parseInt0(s.total_minutes),
    ingredients,
    steps,
    category_id: s.category_id || null,
    tags: s.tags
      .split(/[,#]/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 30),
    visibility: s.visibility,
    personal_note: s.personal_note,
    field_flags,
    diet_hints: knownDiets(s.diet_hints),
    verification_status: opts.review && anyFlags ? ('needs_review' as const) : anyFlags ? ('needs_review' as const) : ('verified' as const),
  };
}
