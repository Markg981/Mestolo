import { describe, expect, it } from 'vitest';
import { isValidSlug, makeRecipeSlug } from '@/lib/recipes/slug';
import { buildRecipeJsonLd, metaDescription, publicRecipeUrl, serializeJsonLd, type PublicRecipe } from '@/lib/recipes/public-page';

const ID = '3f2a9c1e-7b44-4d0a-9d55-0a1b2c3d4e5f';

/** The same vectors are checked against public.make_recipe_slug in tests/db/public-pages.test.ts. */
const SLUG_VECTORS: [string, string][] = [
  ['Tiramisù della nonna', 'tiramisu-della-nonna-3f2a9c1e'],
  ['  Pasta   &  Fagioli!! ', 'pasta-fagioli-3f2a9c1e'],
  ['Crème brûlée', 'creme-brulee-3f2a9c1e'],
  ['Straße', 'strasse-3f2a9c1e'],
  ['!!!', 'ricetta-3f2a9c1e'],
  ['', 'ricetta-3f2a9c1e'],
  ['Año nuevo ñoquis', 'ano-nuevo-noquis-3f2a9c1e'],
];

describe('recipe slug', () => {
  it.each(SLUG_VECTORS)('slugifies %j', (title, expected) => {
    expect(makeRecipeSlug(title, ID)).toBe(expected);
  });

  it('truncates long titles without leaving a dangling hyphen', () => {
    const slug = makeRecipeSlug(`${'a'.repeat(59)} b ccc`, ID);
    expect(slug).toBe(`${'a'.repeat(59)}-3f2a9c1e`);
    expect(isValidSlug(slug)).toBe(true);
  });

  it('always yields a valid slug and is stable for the same input', () => {
    for (const [title] of SLUG_VECTORS) {
      const s = makeRecipeSlug(title, ID);
      expect(isValidSlug(s)).toBe(true);
      expect(makeRecipeSlug(title, ID)).toBe(s);
    }
  });

  it('rejects malformed slugs (path tricks, uppercase, double hyphens)', () => {
    for (const bad of ['', 'A-b', 'a--b', '-a', 'a-', '../x', 'a/b', 'a b', 'x'.repeat(121), null, 42]) expect(isValidSlug(bad)).toBe(false);
    expect(isValidSlug('a')).toBe(true);
  });
});

const recipe: PublicRecipe = {
  id: ID,
  slug: 'torta-3f2a9c1e',
  title: 'Torta </script> di mele',
  description: 'Soffice e semplice.',
  original_language: 'it',
  servings: 8,
  prep_minutes: 20,
  cook_minutes: 90,
  total_minutes: 110,
  ingredients: [
    { name: 'farina', quantity: 250, unit: 'g' },
    { name: 'sale', quantity: null, unit: null, toTaste: true },
  ],
  steps: [{ text: 'Mescola.' }, { text: 'Inforna.' }],
  tags: ['dolce', 'mele'],
  category_slug: 'desserts',
  source_name: null,
  source_url: null,
  author_name: 'Anna',
  author_username: 'anna',
  cover_image_id: '11111111-2222-3333-4444-555555555555',
  cover_alt: null,
  cover_kind: 'upload',
  cover_attribution: null,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-02T10:00:00Z',
};

describe('schema.org Recipe JSON-LD', () => {
  const ld = buildRecipeJsonLd(recipe, { siteUrl: 'https://mestolo.app/', categoryName: 'Dolci' });

  it('has the Recipe fields search engines need', () => {
    expect(ld['@type']).toBe('Recipe');
    expect(ld.name).toBe(recipe.title);
    expect(ld.recipeIngredient).toEqual(['250 g farina', 'sale, q.b.']);
    expect(ld.recipeInstructions).toEqual([
      { '@type': 'HowToStep', text: 'Mescola.' },
      { '@type': 'HowToStep', text: 'Inforna.' },
    ]);
    expect(ld.recipeYield).toBe('8');
    expect(ld.author).toEqual({ '@type': 'Person', name: 'Anna' });
    expect(ld.image).toEqual(['https://mestolo.app/api/public-images/11111111-2222-3333-4444-555555555555']);
    expect(ld.mainEntityOfPage).toBe('https://mestolo.app/r/torta-3f2a9c1e');
    expect(ld.recipeCategory).toBe('Dolci');
  });

  it('formats times as ISO 8601 durations', () => {
    expect(ld.prepTime).toBe('PT20M');
    expect(ld.cookTime).toBe('PT1H30M');
    expect(ld.totalTime).toBe('PT1H50M');
    expect(buildRecipeJsonLd({ ...recipe, prep_minutes: 120, cook_minutes: null }, { siteUrl: 'https://x.y' }).prepTime).toBe('PT2H');
    expect(buildRecipeJsonLd({ ...recipe, cook_minutes: null }, { siteUrl: 'https://x.y' }).cookTime).toBeUndefined();
  });

  it('omits what is unknown and never leaks private fields', () => {
    const bare = buildRecipeJsonLd({ ...recipe, cover_image_id: null, author_name: null, servings: null, tags: [], description: '' }, { siteUrl: 'https://x.y' });
    expect(bare.image).toBeUndefined();
    expect(bare.author).toBeUndefined();
    expect(bare.recipeYield).toBeUndefined();
    expect(bare.keywords).toBeUndefined();
    expect(bare.description).toBeUndefined();
    expect(JSON.stringify(ld)).not.toMatch(/owner|email|note/i);
  });

  it('serializes safely inside a script tag', () => {
    const out = serializeJsonLd(ld);
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<');
    expect(JSON.parse(out).name).toBe(recipe.title);
  });
});

describe('public page helpers', () => {
  it('builds absolute URLs without double slashes', () => {
    expect(publicRecipeUrl('https://mestolo.app///', 'a-b')).toBe('https://mestolo.app/r/a-b');
  });

  it('meta description falls back to ingredients and is capped', () => {
    expect(metaDescription({ description: '', ingredients: recipe.ingredients })).toBe('farina, sale');
    const long = metaDescription({ description: 'parola '.repeat(60), ingredients: [] });
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith('…')).toBe(true);
  });
});
