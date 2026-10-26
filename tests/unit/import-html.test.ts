import { describe, expect, it } from 'vitest';
import { recipeFromHtml, findRecipeNode } from '@/lib/import/recipe-from-html';

const jsonLdPage = (data: unknown, extra = '') => `<!doctype html><html lang="it"><head>
<meta property="og:site_name" content="Cucina di Prova">
<script type="application/ld+json">${JSON.stringify(data)}</script>${extra}</head><body><h1>x</h1></body></html>`;

describe('schema.org Recipe extraction', () => {
  it('extracts a Recipe inside @graph, with sections and ISO durations', () => {
    const html = jsonLdPage({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Cucina di Prova' },
        {
          '@type': ['Recipe', 'NewsArticle'],
          name: 'Ragù alla napoletana',
          description: 'Il ragù della domenica &amp; della nonna',
          recipeYield: ['6', '6 porzioni'],
          prepTime: 'PT30M',
          cookTime: 'PT6H',
          totalTime: 'PT6H30M',
          recipeCategory: 'Secondi piatti',
          author: [{ '@type': 'Person', name: 'Maria Rossi' }],
          image: [{ '@type': 'ImageObject', url: '/img/ragu.jpg' }],
          recipeIngredient: ['1 kg di carne di manzo', '2 l passata di pomodoro', 'Sale q.b.'],
          recipeInstructions: [
            { '@type': 'HowToSection', name: 'Soffritto', itemListElement: [{ '@type': 'HowToStep', text: 'Tritare la cipolla.' }] },
            { '@type': 'HowToStep', text: 'Cuocere a fuoco lento.' },
          ],
        },
      ],
    });
    const { draft } = recipeFromHtml(html, 'https://cucina.example/ragu');
    expect(draft).not.toBeNull();
    const d = draft!;
    expect(d.source).toMatchObject({
      type: 'url', url: 'https://cucina.example/ragu', name: 'Cucina di Prova', attribution: 'Maria Rossi',
      imageUrl: 'https://cucina.example/img/ragu.jpg', method: 'jsonld',
    });
    expect(d.content).toMatchObject({
      title: 'Ragù alla napoletana',
      description: 'Il ragù della domenica & della nonna',
      servings: 6, prep_minutes: 30, cook_minutes: 360, total_minutes: 390, original_language: 'it',
      category_slug: 'main-courses',
    });
    expect(d.content.ingredients[0]).toMatchObject({ quantity: 1, unit: 'kg', name: 'carne di manzo' });
    expect(d.content.ingredients[2]).toMatchObject({ toTaste: true });
    expect(d.content.steps).toEqual([
      { text: 'Tritare la cipolla.', section: 'Soffritto' },
      { text: 'Cuocere a fuoco lento.', section: null },
    ]);
    expect(d.field_flags).toEqual({});
  });

  it('marks missing fields instead of inventing them', () => {
    const html = jsonLdPage({ '@type': 'Recipe', name: 'Biscotti', recipeIngredient: ['farina', 'zucchero'], recipeInstructions: 'Impastare.<br>Cuocere.' });
    const d = recipeFromHtml(html, 'https://x.example/b').draft!;
    expect(d.content.servings).toBeNull();
    expect(d.field_flags.servings).toEqual(['missing']);
    expect(d.field_flags.cook_minutes).toEqual(['missing']);
    expect(d.content.ingredients[0].flags).toEqual(['missing']);
    expect(d.content.steps.map((s) => s.text)).toEqual(['Impastare.', 'Cuocere.']);
  });

  it('tolerates broken JSON-LD blocks and finds the valid one', () => {
    const html = `<html><head><script type="application/ld+json">{ broken </script>
      <script type="application/ld+json">{"@type":"Recipe","name":"Ok","recipeIngredient":["1 uovo"]};</script></head></html>`;
    expect(recipeFromHtml(html, 'https://x.example').draft?.content.title).toBe('Ok');
  });

  it('falls back to microdata', () => {
    const html = `<html><body><div itemscope itemtype="http://schema.org/Recipe">
      <h1 itemprop="name">Insalata di riso</h1>
      <span itemprop="recipeYield">4 persone</span>
      <li itemprop="recipeIngredient">300 g riso</li><li itemprop="recipeIngredient">1 scatola di tonno</li>
      <div itemprop="recipeInstructions">Lessare il riso.</div></div></body></html>`;
    const d = recipeFromHtml(html, 'https://x.example').draft!;
    expect(d.source.method).toBe('microdata');
    expect(d.content.servings).toBe(4);
    expect(d.content.ingredients).toHaveLength(2);
  });

  it('falls back to page text, flagged as low confidence', () => {
    const html = `<html lang="en"><head><title>Simple Bread</title></head><body><nav>Menu</nav><article>
      <p>Ingredients</p><ul><li>500 g flour</li><li>10 g salt</li></ul><p>Method</p><p>Mix and knead.</p></article></body></html>`;
    const d = recipeFromHtml(html, 'https://x.example').draft!;
    expect(d.source.method).toBe('text');
    expect(d.warnings.map((w) => w.code)).toContain('no_structured_data');
    expect(d.content.ingredients[0].flags).toContain('low_confidence');
    expect(d.content.original_language).toBe('en');
  });

  it('returns no draft when the page has no recipe-like content', () => {
    const r = recipeFromHtml('<html><body><p>Abbonati per leggere</p></body></html>', 'https://x.example');
    expect(r.draft).toBeNull();
  });

  it('findRecipeNode handles nested arrays and mainEntity', () => {
    expect(findRecipeNode([{ mainEntity: { '@type': 'Recipe', name: 'A' } }])).toMatchObject({ name: 'A' });
    expect(findRecipeNode({ '@type': 'Article' })).toBeNull();
  });
});

describe('performance on large pages without JSON-LD', () => {
  it('extracts text in linear time from a large page of <div> elements', () => {
    const page = (n: number) => `<html><body>${'<div>x</div>'.repeat(n)}</body></html>`;
    const time = (html: string) => {
      const t0 = performance.now();
      const res = recipeFromHtml(html, 'https://example.com/r');
      expect(res.pageText.length).toBeGreaterThan(0);
      return performance.now() - t0;
    };
    const small = page(20_000);
    const large = page(80_000);
    expect(large.length).toBeGreaterThan(800_000);
    time(small); // warm-up (JIT)
    // Best of 3 per size, to reduce noise from slow/shared CI runners.
    const tSmall = Math.min(time(small), time(small), time(small));
    const tLarge = Math.min(time(large), time(large), time(large));
    // 4x the input: linear ~4x, quadratic ~16x. Threshold sits well in between.
    expect(tLarge / Math.max(tSmall, 1)).toBeLessThan(9);
    // Generous backstop against catastrophic regressions.
    expect(tLarge).toBeLessThan(10_000);
  });
});
