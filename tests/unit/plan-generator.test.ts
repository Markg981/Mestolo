import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, generatePlan, isEligible, planCells, type Candidate, type PlanPrefs } from '@/lib/plan/generator';
import { weekDays } from '@/lib/plan/week';

const week = weekDays('2026-10-26'); // lunedi'
const mk = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  title: `Ricetta ${id}`,
  totalMinutes: 30,
  categoryId: null,
  tags: [],
  ingredientNames: [],
  ratingAvg: null,
  ratingCount: 0,
  myStars: null,
  favorite: false,
  cookedCount: 0,
  lastCookedDaysAgo: null,
  servings: 4,
  ...over,
});
const pool = Array.from({ length: 20 }, (_, i) => mk(`r${i}`, { categoryId: `c${i % 4}` }));
const prefs = (over: Partial<PlanPrefs> = {}): PlanPrefs => ({ ...DEFAULT_PREFS, ...over });

describe('planCells', () => {
  it('rispetta giorni e pasti scelti, in ordine cronologico', () => {
    const cells = planCells(week, prefs({ days: [0, 6], meals: ['dinner', 'lunch'] }));
    expect(cells.map((c) => `${c.date}/${c.slot}`)).toEqual(['2026-10-26/lunch', '2026-10-26/dinner', '2026-11-01/lunch', '2026-11-01/dinner']);
  });
});

describe('generatePlan', () => {
  const cells = planCells(week, prefs());
  it('e riproducibile con lo stesso seed e cambia con un altro', () => {
    const a = generatePlan({ candidates: pool, prefs: prefs(), cells, seed: 7 });
    const b = generatePlan({ candidates: pool, prefs: prefs(), cells, seed: 7 });
    const c = generatePlan({ candidates: pool, prefs: prefs(), cells, seed: 8 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(cells.length);
  });

  it('non ripete ricette con repeat low se il pool basta', () => {
    const r = generatePlan({ candidates: pool, prefs: prefs({ repeatLevel: 'low' }), cells, seed: 1 });
    expect(new Set(r.map((p) => p.recipeId)).size).toBe(r.length);
  });

  it('con pool piccolo ripete ma non in giorni ravvicinati con la stessa ricetta due volte di fila', () => {
    const small = [mk('a'), mk('b'), mk('c')];
    const r = generatePlan({ candidates: small, prefs: prefs({ repeatLevel: 'medium' }), cells, seed: 3 });
    for (let i = 1; i < r.length; i++) expect(r[i].recipeId).not.toBe(r[i - 1].recipeId);
  });

  it('esclude tag, categorie, ingredienti e valutazioni basse', () => {
    const cs = [
      mk('tag', { tags: ['Vegano'] }),
      mk('cat', { categoryId: 'x' }),
      mk('ing', { ingredientNames: ['Noci tritate'] }),
      mk('bad', { myStars: 1 }),
      mk('ok'),
    ];
    const r = generatePlan({ candidates: cs, prefs: prefs({ excludedTags: ['vegano'], excludedCategoryIds: ['x'], avoidIngredients: ['noci'] }), cells, seed: 1 });
    expect(new Set(r.map((p) => p.recipeId))).toEqual(new Set(['ok']));
  });

  it('applica il tempo massimo solo nei giorni feriali', () => {
    const slow = mk('slow', { totalMinutes: 120 });
    const fast = mk('fast', { totalMinutes: 20 });
    const p = prefs({ weekdayMaxMinutes: 30 });
    expect(isEligible(slow, { date: '2026-10-26', slot: 'dinner' }, p)).toBe(false);
    expect(isEligible(slow, { date: '2026-10-31', slot: 'dinner' }, p)).toBe(true);
    const r = generatePlan({ candidates: [slow, fast], prefs: p, cells, seed: 2 });
    for (const x of r.filter((y) => y.date < '2026-10-31')) expect(x.recipeId).toBe('fast');
  });

  it('preferisce preferiti e ricette ben valutate', () => {
    const cs = [mk('plain'), mk('fav', { favorite: true, ratingAvg: 4.9, ratingCount: 40, myStars: 5, cookedCount: 3 })];
    const r = generatePlan({ candidates: cs, prefs: prefs({ repeatLevel: 'high' }), cells: cells.slice(0, 1), seed: 5 });
    expect(r[0].recipeId).toBe('fav');
  });

  it('usa le porzioni preferite e lascia vuote le celle senza candidati', () => {
    const r = generatePlan({ candidates: [mk('a')], prefs: prefs({ servings: 2 }), cells: cells.slice(0, 2), seed: 1 });
    expect(r.every((p) => p.servings === 2)).toBe(true);
    expect(generatePlan({ candidates: [], prefs: prefs(), cells, seed: 1 })).toEqual([]);
  });

  it('tiene conto di existing ed excludeRecipeIds', () => {
    const cs = [mk('a'), mk('b')];
    const r = generatePlan({ candidates: cs, prefs: prefs(), cells: cells.slice(0, 1), seed: 1, excludeRecipeIds: ['a'] });
    expect(r[0].recipeId).toBe('b');
  });
});
