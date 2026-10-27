import { describe, expect, it } from 'vitest';
import { suggestCategory } from '@/lib/recipes/classify';
import { findPossibleDuplicates, normalizeSourceUrl, titleSimilarity } from '@/lib/recipes/duplicates';
import { scaleIngredients } from '@/lib/recipes/scale';
import { planShoppingMerge } from '@/lib/shopping/merge';
import { applySuggestions, analysisSchema, type Suggestion } from '@/lib/recipes/suggestions';
import { buildTranslatable, mergeTranslation, isTranslationFresh, TranslationShapeError } from '@/lib/recipes/translation';
import { findBuiltinSubstitutions } from '@/lib/recipes/substitutions';
import { toSchemaOrg, ingredientToText } from '@/lib/recipes/export';
import { recipeInputSchema, cleanEditorPayload } from '@/lib/recipes/schema';
import type { RecipeContent, RecipeRow } from '@/lib/recipes/types';

describe('category suggestion', () => {
  it('suggests clear categories', () => {
    expect(suggestCategory({ title: 'Spaghetti alla carbonara' }).slug).toBe('first-courses');
    expect(suggestCategory({ title: 'Torta di mele della nonna' }).slug).toBe('desserts');
    expect(suggestCategory({ title: 'Focaccia genovese' }).slug).toBe('bread-baking');
    expect(suggestCategory({ title: 'Chocolate chip cookies' }).slug).toBe('desserts');
    expect(suggestCategory({ title: 'Mystery', hints: ['Dessert'] }).slug).toBe('desserts');
  });
  it('returns "uncategorized" when uncertain instead of guessing', () => {
    expect(suggestCategory({ title: 'La ricetta di zia Pina' }).slug).toBe('uncategorized');
    // conflicting evidence: pasta + dessert → no clear margin
    expect(suggestCategory({ title: 'Pasta dolce' }).slug).toBe('uncategorized');
  });
});

describe('duplicate detection', () => {
  const existing = [
    { id: '1', title: 'Spaghetti alla Carbonara', source_url: 'https://www.site.it/carbonara/?utm_source=x', ingredientNames: ['spaghetti', 'guanciale', 'uova', 'pecorino'] },
    { id: '2', title: 'Torta di mele', ingredientNames: ['mele', 'farina', 'zucchero', 'uova'] },
  ];
  it('matches the same source URL ignoring tracking params', () => {
    expect(normalizeSourceUrl('https://site.it/carbonara')).toBe(normalizeSourceUrl('https://www.site.it/carbonara/?utm_source=x'));
    const m = findPossibleDuplicates({ title: 'Altro', source_url: 'https://site.it/carbonara', ingredientNames: [] }, existing);
    expect(m[0]).toMatchObject({ id: '1', reason: 'same_source' });
  });
  it('matches very similar titles', () => {
    expect(titleSimilarity('Spaghetti carbonara', 'Spaghetti alla carbonara')).toBe(1);
    const m = findPossibleDuplicates({ title: 'spaghetti alla carbonara!', ingredientNames: [] }, existing);
    expect(m[0].id).toBe('1');
  });
  it('matches similar title + overlapping ingredients', () => {
    const m = findPossibleDuplicates({ title: 'Torta di mele soffice', ingredientNames: ['Mele', 'farina', 'zucchero', 'uova', 'burro'] }, existing);
    expect(m.map((x) => x.id)).toContain('2');
  });
  it('does not flag unrelated recipes or itself', () => {
    expect(findPossibleDuplicates({ title: 'Risotto ai funghi', ingredientNames: ['riso'] }, existing)).toEqual([]);
    expect(findPossibleDuplicates({ title: 'Torta di mele', ingredientNames: [] }, existing, '2')).toEqual([]);
  });
});

describe('scaling', () => {
  it('scales known quantities only and never converts units', () => {
    const r = scaleIngredients(
      [
        { name: 'farina', quantity: 300, unit: 'g' },
        { name: 'uova', quantity: 3, unit: null },
        { name: 'sale', quantity: null, unit: null, toTaste: true },
        { name: 'aglio', quantity: 1, quantityMax: 2, unit: 'clove' },
      ],
      4,
      6,
    );
    expect(r.map((i) => [i.quantity, i.unit])).toEqual([[450, 'g'], [4.5, null], [null, null], [1.5, 'clove']]);
    expect(r[3].quantityMax).toBe(3);
  });
  it('never rounds a positive quantity to zero', () => {
    expect(scaleIngredients([{ name: 'sale', quantity: 0.5, unit: 'g' }], 100, 1)[0].quantity).toBe(0.01);
  });
  it('rounds countable items to halves with a minimum of 0.5', () => {
    const r = scaleIngredients(
      [
        { name: 'uova', quantity: 1, unit: null },
        { name: 'aglio', quantity: 2, unit: 'clove' },
        { name: 'uova', quantity: 3, unit: null },
      ],
      4,
      1,
    );
    expect(r.map((i) => i.quantity)).toEqual([0.5, 0.5, 1]);
    expect(scaleIngredients([{ name: 'uova', quantity: 3, unit: 'piece' }], 4, 5)[0].quantity).toBe(4);
  });
  it('is a no-op when servings are unknown', () => {
    expect(scaleIngredients([{ name: 'x', quantity: 1, unit: 'g' }], null, 4)[0].quantity).toBe(1);
  });
});

describe('shopping list merge', () => {
  const existing = [
    { id: 'a', name: 'Farina 00', quantity: 200, unit: 'g', checked: false },
    { id: 'b', name: 'Sale', quantity: null, unit: null, checked: false },
    { id: 'c', name: 'Latte', quantity: 500, unit: 'ml', checked: true },
  ];
  it('sums only identical names with identical units', () => {
    const plan = planShoppingMerge(existing, [
      { name: 'farina 00', quantity: 300, unit: 'g' },
      { name: 'Farina 00', quantity: 1, unit: 'cup' }, // incompatible unit
      { name: 'Farina integrale', quantity: 100, unit: 'g' }, // different product
      { name: 'sale', quantity: null, unit: null }, // dedupe without quantity
      { name: 'latte', quantity: 250, unit: 'ml' }, // existing is checked → new line
    ]);
    expect(plan.updates).toEqual([{ id: 'a', quantity: 500, delta: 300 }]);
    expect(plan.inserts.map((i) => `${i.name}|${i.unit}|${i.quantity}`)).toEqual([
      'Farina 00|cup|1', 'Farina integrale|g|100', 'latte|ml|250',
    ]);
  });
  it('reports the delta to add, accumulated over repeated lines', () => {
    const plan = planShoppingMerge([{ id: 'x', name: 'farina', quantity: 100.5, unit: 'g' }], [
      { name: 'farina', quantity: 50, unit: 'g' },
      { name: 'Farina', quantity: 25.25, unit: 'g' },
    ]);
    expect(plan.updates).toEqual([{ id: 'x', quantity: 175.75, delta: 75.25 }]);
  });
  it('does not merge "uovo" and "uova" (no guessing)', () => {
    const plan = planShoppingMerge([{ id: 'x', name: 'uovo', quantity: 1, unit: null }], [{ name: 'uova', quantity: 2, unit: null }]);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toHaveLength(1);
  });
  it('keeps quantity-less and quantified lines separate', () => {
    const plan = planShoppingMerge([{ id: 'x', name: 'zucchero', quantity: null, unit: null }], [{ name: 'zucchero', quantity: 100, unit: null }]);
    expect(plan.inserts).toHaveLength(1);
  });
  it('merges duplicates within the same batch', () => {
    const plan = planShoppingMerge([], [{ name: 'uova', quantity: 2, unit: null }, { name: 'Uova', quantity: 3, unit: null }]);
    expect(plan.inserts).toEqual([{ name: 'uova', quantity: 5, unit: null }]);
  });
});

const base: RecipeContent = {
  title: 'Frittata',
  description: '',
  original_language: 'it',
  servings: 2,
  prep_minutes: null,
  cook_minutes: 10,
  total_minutes: null,
  ingredients: [
    { name: 'uova', quantity: 4, unit: null },
    { name: 'parmigiano', quantity: null, unit: null },
  ],
  steps: [{ text: 'sbattere uova' }, { text: 'cuocere' }],
  category_id: null,
  tags: [],
};

describe('AI suggestions application', () => {
  const suggestions: Suggestion[] = analysisSchema.parse({
    summary: 'ok',
    suggestions: [
      { id: 's1', type: 'step_rewrite', stepIndex: 0, before: 'sbattere uova', after: 'Sbattere le uova con un pizzico di sale.', reason: 'chiarezza' },
      { id: 's2', type: 'ingredient_fix', ingredientIndex: 1, before: 'parmigiano', after: { name: 'parmigiano grattugiato', quantity: 30, unit: 'g', note: null }, reason: 'quantità mancante' },
      { id: 's3', type: 'time_estimate', field: 'prep_minutes', before: null, after: 5, reason: 'stima' },
      { id: 's4', type: 'ingredient_add', after: { name: 'sale', quantity: null, unit: null }, reason: 'citato nei passaggi' },
      { id: 's5', type: 'idea', title: 'Variante', text: 'Aggiungi zucchine' },
    ],
  }).suggestions;

  it('applies only the selected suggestions and never mutates the original', () => {
    const snapshot = structuredClone(base);
    const r = applySuggestions(base, {}, suggestions, ['s1', 's3']);
    expect(r.applied).toEqual(['s1', 's3']);
    expect(r.content.steps[0].text).toBe('Sbattere le uova con un pizzico di sale.');
    expect(r.content.ingredients[1].quantity).toBeNull(); // s2 not selected
    expect(r.content.prep_minutes).toBe(5);
    expect(r.fieldFlags.prep_minutes).toEqual(['ai_estimate']); // estimate stays marked
    expect(base).toEqual(snapshot);
  });

  it('applies ingredient fixes and additions, ignores ideas', () => {
    const r = applySuggestions(base, {}, suggestions, ['s2', 's4', 's5']);
    expect(r.content.ingredients[1]).toMatchObject({ name: 'parmigiano grattugiato', quantity: 30, unit: 'g' });
    expect(r.content.ingredients[2]).toMatchObject({ name: 'sale' });
    expect(r.skipped).toEqual([{ id: 's5', reason: 'not_applicable' }]);
  });

  it('skips stale suggestions when the recipe changed after the analysis', () => {
    const changed = { ...base, steps: [{ text: 'testo cambiato' }, { text: 'cuocere' }] };
    const r = applySuggestions(changed, {}, suggestions, ['s1']);
    expect(r.applied).toEqual([]);
    expect(r.skipped).toEqual([{ id: 's1', reason: 'stale' }]);
  });

  it('rejects malformed AI output', () => {
    expect(() => analysisSchema.parse({ suggestions: [{ id: 'x', type: 'delete_everything' }] })).toThrow();
  });
});

describe('translation', () => {
  it('sends only text and re-attaches quantities/units from the original', () => {
    const payload = buildTranslatable(base);
    expect(JSON.stringify(payload)).not.toContain('"quantity"');
    const merged = mergeTranslation(base, {
      title: 'Omelette',
      description: '',
      ingredients: [{ name: 'eggs', note: null }, { name: 'parmesan', note: null }],
      steps: [{ text: 'beat the eggs' }, { text: 'cook' }],
    });
    expect(merged.title).toBe('Omelette');
    expect(merged.ingredients.map((i) => [i.name, i.quantity, i.unit])).toEqual([['eggs', 4, null], ['parmesan', null, null]]);
    expect(base.title).toBe('Frittata'); // original preserved
  });
  it('rejects translations with a different structure', () => {
    expect(() => mergeTranslation(base, { title: 'x', description: '', ingredients: [], steps: [] })).toThrow(TranslationShapeError);
  });
  it('invalidates cached translations when the content hash changes', () => {
    expect(isTranslationFresh('abc', 'abc')).toBe(true);
    expect(isTranslationFresh('abc', 'def')).toBe(false);
    expect(isTranslationFresh(null, 'def')).toBe(false);
  });
});

describe('built-in substitutions', () => {
  it('finds suggestions with limits in the requested language', () => {
    const r = findBuiltinSubstitutions('Burro morbido', 'en');
    expect(r[0].name).toBe('Extra virgin olive oil');
    expect(r[0].limitations).toMatch(/puff pastry/);
    expect(findBuiltinSubstitutions('uova', 'it')[0].limitations).toMatch(/Non monta/);
  });
  it('returns nothing for unknown ingredients (no invention)', () => {
    expect(findBuiltinSubstitutions('zafferano', 'it')).toEqual([]);
  });
});

describe('export & validation', () => {
  it('exports schema.org JSON-LD with ISO durations', () => {
    const row = { ...base, id: 'r1', owner_id: 'u', source_type: 'manual', source_url: null, source_name: null, source_attribution: null, visibility: 'private', verification_status: 'verified', field_flags: {}, diet_hints: [], parent_recipe_id: null, copied_from_recipe_id: null, original_author_id: null, original_author_name: null, version: 1, content_hash: '', is_hidden: false, rating_avg: null, rating_count: 0, created_at: '2026-01-01', updated_at: '2026-01-01', cook_minutes: 90 } as RecipeRow;
    const ld = toSchemaOrg(row, { authorName: 'Marco' });
    expect(ld).toMatchObject({ '@type': 'Recipe', name: 'Frittata', cookTime: 'PT1H30M', recipeYield: '2' });
    expect(ld.recipeIngredient).toEqual(['4 uova', 'parmigiano']);
    expect(ingredientToText({ name: 'sale', quantity: null, unit: null, toTaste: true })).toBe('sale, q.b.');
  });
  it('defaults visibility to private and strips empty editor rows', () => {
    const parsed = recipeInputSchema.parse(
      cleanEditorPayload({
        title: ' Test ', servings: null, prep_minutes: null, cook_minutes: null, total_minutes: null, category_id: null, tags: ['Veloce', 'veloce'],
        ingredients: [{ name: 'farina', quantity: 100, unit: 'g' }, { name: '', quantity: null, unit: null }],
        steps: [{ text: '' }, { text: 'Impastare' }],
      }),
    );
    expect(parsed.visibility).toBe('private');
    expect(parsed.title).toBe('Test');
    expect(parsed.tags).toEqual(['veloce']);
    expect(parsed.ingredients).toHaveLength(1);
    expect(parsed.steps).toHaveLength(1);
  });
  it('rejects non-http source URLs', () => {
    expect(() => recipeInputSchema.parse({ title: 'x', servings: null, prep_minutes: null, cook_minutes: null, total_minutes: null, category_id: null, tags: [], ingredients: [], steps: [], source_url: 'javascript:alert(1)' })).toThrow();
  });
});
