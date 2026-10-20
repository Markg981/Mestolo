/**
 * Generatore deterministico del piano settimanale. Logica pura: nessun accesso a DB, rete o orologio.
 * A parita' di input e di seed produce sempre lo stesso risultato. Nessuna AI.
 */
import { parseIsoDate, type MealSlot } from './week';

export type RepeatLevel = 'low' | 'medium' | 'high';

export interface PlanPrefs {
  meals: MealSlot[];
  /** 0 = lunedi' ... 6 = domenica */
  days: number[];
  weekdayMaxMinutes: number | null;
  preferredTags: string[];
  excludedTags: string[];
  preferredCategoryIds: string[];
  excludedCategoryIds: string[];
  avoidIngredients: string[];
  repeatLevel: RepeatLevel;
  servings: number | null;
}

export const DEFAULT_PREFS: PlanPrefs = {
  meals: ['lunch', 'dinner'],
  days: [0, 1, 2, 3, 4, 5, 6],
  weekdayMaxMinutes: null,
  preferredTags: [],
  excludedTags: [],
  preferredCategoryIds: [],
  excludedCategoryIds: [],
  avoidIngredients: [],
  repeatLevel: 'medium',
  servings: null,
};

export interface Candidate {
  id: string;
  title: string;
  totalMinutes: number | null;
  categoryId: string | null;
  tags: string[];
  ingredientNames: string[];
  ratingAvg: number | null;
  ratingCount: number;
  /** valutazione data dall'utente (1-5) */
  myStars: number | null;
  favorite: boolean;
  /** quante volte l'utente l'ha cucinata (cook_logs) */
  cookedCount: number;
  /** giorni dall'ultima volta cucinata, null = mai */
  lastCookedDaysAgo: number | null;
  servings: number | null;
}

export interface Cell {
  date: string;
  slot: MealSlot;
}

export interface Proposal extends Cell {
  recipeId: string;
  title: string;
  servings: number | null;
}

export interface GenerateInput {
  candidates: Candidate[];
  prefs: PlanPrefs;
  /** celle da riempire (gia' filtrate per giorni/pasti e non occupate) */
  cells: Cell[];
  /** ricette gia' presenti in piano (stessa settimana) con la loro cella: contano per la varieta' */
  existing?: { cell: Cell; recipeId: string; categoryId: string | null }[];
  seed: number;
  /** ricette da non riproporre (es. rigenerazione di un solo slot) */
  excludeRecipeIds?: string[];
}

/** PRNG mulberry32: piccolo, veloce e riproducibile. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const norm = (s: string) => s.trim().toLowerCase();

/** 0 = lunedi' ... 6 = domenica */
export function dayIndex(iso: string): number {
  return (parseIsoDate(iso).getUTCDay() + 6) % 7;
}

const isWeekday = (iso: string) => dayIndex(iso) < 5;

/** Celle (giorno x pasto) da coprire in una settimana, secondo le preferenze, in ordine cronologico. */
export function planCells(weekDaysIso: string[], prefs: PlanPrefs): Cell[] {
  const order: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
  const cells: Cell[] = [];
  for (const date of weekDaysIso) {
    if (!prefs.days.includes(dayIndex(date))) continue;
    for (const slot of order) if (prefs.meals.includes(slot)) cells.push({ date, slot });
  }
  return cells;
}

/** True se la ricetta puo' stare in quella cella rispettando esclusioni, ingredienti da evitare e tempo. */
export function isEligible(c: Candidate, cell: Cell, prefs: PlanPrefs): boolean {
  if (c.myStars !== null && c.myStars <= 2) return false;
  const tags = c.tags.map(norm);
  if (prefs.excludedTags.some((t) => tags.includes(norm(t)))) return false;
  if (c.categoryId && prefs.excludedCategoryIds.includes(c.categoryId)) return false;
  const avoid = prefs.avoidIngredients.map(norm).filter(Boolean);
  if (avoid.length) {
    const names = c.ingredientNames.map(norm);
    if (avoid.some((a) => names.some((n) => n.includes(a)))) return false;
  }
  if (prefs.weekdayMaxMinutes !== null && isWeekday(cell.date) && c.totalMinutes !== null && c.totalMinutes > prefs.weekdayMaxMinutes) return false;
  return true;
}

const REPEAT_PENALTY: Record<RepeatLevel, number> = { low: 6, medium: 3, high: 1 };

/** Punteggio di qualita' indipendente dalla cella (preferiti, valutazioni, cucinate, gusti). */
export function baseScore(c: Candidate, prefs: PlanPrefs): number {
  let s = 0;
  if (c.favorite) s += 2;
  // media bayesiana: poche valutazioni pesano poco
  const prior = 3.5;
  const w = 5;
  if (c.ratingAvg !== null && c.ratingCount > 0) s += ((c.ratingAvg * c.ratingCount + prior * w) / (c.ratingCount + w) - prior) * 1.2;
  if (c.myStars !== null) s += (c.myStars - 3) * 0.8;
  if (c.cookedCount > 0) s += Math.min(1.5, Math.log1p(c.cookedCount) * 0.6);
  if (c.lastCookedDaysAgo !== null && c.lastCookedDaysAgo < 7) s -= 1.5;
  const tags = c.tags.map(norm);
  s += Math.min(2, prefs.preferredTags.filter((t) => tags.includes(norm(t))).length * 0.8);
  if (c.categoryId && prefs.preferredCategoryIds.includes(c.categoryId)) s += 1.5;
  return s;
}

/** Riempie le celle richieste. Le celle senza ricetta adatta restano senza proposta. */
export function generatePlan(input: GenerateInput): Proposal[] {
  const { candidates, prefs, seed } = input;
  const rand = mulberry32(seed);
  const excluded = new Set(input.excludeRecipeIds ?? []);
  const pool = candidates.filter((c) => !excluded.has(c.id));
  const base = new Map(pool.map((c) => [c.id, baseScore(c, prefs)]));
  const used = new Map<string, number>();
  const placed: { cell: Cell; recipeId: string; categoryId: string | null }[] = [...(input.existing ?? [])];
  for (const p of placed) used.set(p.recipeId, (used.get(p.recipeId) ?? 0) + 1);

  const out: Proposal[] = [];
  for (const cell of input.cells) {
    let best: Candidate | null = null;
    let bestScore = -Infinity;
    for (const c of pool) {
      if (!isEligible(c, cell, prefs)) continue;
      let s = base.get(c.id) ?? 0;
      const times = used.get(c.id) ?? 0;
      if (times > 0) s -= REPEAT_PENALTY[prefs.repeatLevel] * times + (prefs.repeatLevel === 'low' ? 20 : 0);
      for (const p of placed) {
        const gap = Math.abs(dayDiff(p.cell.date, cell.date));
        if (p.recipeId === c.id && gap <= 2) s -= 6 - gap * 2;
        if (c.categoryId && p.categoryId === c.categoryId) s -= gap === 0 ? 1.2 : gap <= 1 ? 0.9 : 0.3;
      }
      s += rand() * 1.5; // varia a parita' di condizioni, ma resta riproducibile con il seed
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (!best) continue;
    used.set(best.id, (used.get(best.id) ?? 0) + 1);
    placed.push({ cell, recipeId: best.id, categoryId: best.categoryId });
    out.push({ ...cell, recipeId: best.id, title: best.title, servings: prefs.servings ?? best.servings });
  }
  return out;
}

function dayDiff(a: string, b: string): number {
  return Math.round((parseIsoDate(a).getTime() - parseIsoDate(b).getTime()) / 86400000);
}

