import { TO_TASTE_PATTERNS, normalizeUnit } from '@/lib/recipes/units';
import { parseNumber } from '@/lib/recipes/ingredient-parser';
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

const UNI = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const QTY_RE = new RegExp(`^(\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*\\/\\s*\\d+|\\d+(?:[.,]\\d+)*\\s*[${UNI}]?|[${UNI}])\\s*(.*)$`);

export type ParsedQuantity = { value: number | null; unit: string | null; toTaste: boolean; invalid: boolean };

/**
 * Parses what the user typed in a quantity field, reusing the ingredient parser's number rules
 * (fractions, unicode fractions, "1.000,5", "1,5"). An attached unit ("2kg") is returned separately.
 * Non-empty input that cannot be interpreted is reported as `invalid`, never silently dropped.
 */
export function parseQuantity(input: string): ParsedQuantity {
  const t = input.trim();
  const none = { value: null, unit: null, toTaste: false, invalid: false };
  if (!t) return none;
  if (TO_TASTE_PATTERNS.some((re) => re.test(t))) return { ...none, toTaste: true };
  const m = t.match(QTY_RE);
  if (!m) return { ...none, invalid: true };
  const unit = m[2] ? normalizeUnit(m[2]) : null;
  if (m[2] && !unit) return { ...none, invalid: true };
  let numText = m[1];
  // "1.000,5" / "1,000.5": when both separators appear, the last one is the decimal point
  if (/[.,]\d+[.,]\d+$/.test(numText) && /[.,]\d{1,2}$|[.,]\d{4,}$/.test(numText)) {
    const last = Math.max(numText.lastIndexOf('.'), numText.lastIndexOf(','));
    numText = numText.slice(0, last).replace(/[.,]/g, '') + '.' + numText.slice(last + 1);
  }
  const value = parseNumber(numText, unit);
  if (value === null || !(value > 0)) return { ...none, invalid: true };
  return { value, unit, toTaste: false, invalid: false };
}

function parseNum(s: string): number | null {
  const q = parseQuantity(s);
  return q.unit || q.toTaste ? null : q.value;
}

/** Ingredient rows (with a name) whose quantity text cannot be interpreted: the save must be blocked. */
export function invalidQuantityIngredients(s: EditorState): EditorIngredient[] {
  return s.ingredients.filter((i) => i.name.trim() && !i.toTaste && (parseQuantity(i.quantity).invalid || parseQuantity(i.quantityMax).invalid));
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
      const pq = parseQuantity(i.quantity);
      const unitText = i.unit.trim() || pq.unit || '';
      const unit = unitText ? labelToUnit.get(unitText.toLowerCase()) ?? normalizeUnit(unitText) ?? unitText : null;
      const toTaste = i.toTaste || pq.toTaste;
      const quantity = toTaste ? null : pq.value;
      const quantityMax = quantity !== null ? parseNum(i.quantityMax) : null;
      let flags = opts.verified ? i.flags.filter((f) => f === 'ai_estimate') : i.flags;
      if (quantity !== null || toTaste) flags = flags.filter((f) => f !== 'missing');
      return {
        name: i.name.trim(),
        quantity,
        quantityMax: quantityMax && quantity !== null && quantityMax > quantity ? quantityMax : null,
        unit,
        note: i.note.trim() || null,
        section: i.section,
        toTaste: toTaste || undefined,
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

/**
 * Payload for one recipe of a bulk import (account export), saved as private exactly as the review
 * editor would (the server validates it again). Bulk import skips the review screen, so every recipe
 * is saved as "needs review": the recipe page and the home list ask the user to check it, and saving
 * it from the editor marks it verified.
 */
export function bulkImportPayload(d: ImportDraft, categories: EditorCategory[]) {
  // Units in a Mestolo export are already canonical keys: no label mapping needed.
  const state = stateFromDraft(d, categories, (k) => k);
  return {
    ...toPayload(state, new Map(), { verified: false, review: true }),
    verification_status: 'needs_review' as const,
    source_type: d.source.type,
    source_url: d.source.url ?? null,
    source_name: d.source.name ?? null,
    source_attribution: d.source.attribution ?? null,
  };
}

/**
 * Guardia anti doppio salvataggio: esegue `fn` una sola volta alla volta.
 * Dopo un salvataggio riuscito il lock resta attivo (la navigazione e' in corso e
 * `expectedVersion` e' ormai obsoleto: un secondo invio darebbe un falso conflict
 * contro il salvataggio dell'utente stesso); si rilascia solo in caso di errore.
 */
export function createSaveGuard() {
  let locked = false;
  return {
    get locked() {
      return locked;
    },
    async run<T extends { ok: boolean }>(fn: () => Promise<T>): Promise<T | null> {
      if (locked) return null;
      locked = true;
      let keep = false;
      try {
        const res = await fn();
        keep = res.ok;
        return res;
      } finally {
        if (!keep) locked = false;
      }
    },
  };
}
