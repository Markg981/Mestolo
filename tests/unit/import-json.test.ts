import { describe, expect, it } from 'vitest';
import { ACCOUNT_EXPORT_FORMAT, parseMestoloExport } from '@/lib/recipes/import-json';
import { MESTOLO_FORMAT } from '@/lib/recipes/export';

const ing = (name: string) => ({ name, quantity: 100, unit: 'g', note: null, section: null, raw: null });
const step = (text: string) => ({ text, section: null });

describe('import of Mestolo JSON exports', () => {
  it('reads a mestolo.recipe/v1 file and never carries over ids or visibility', () => {
    const res = parseMestoloExport(
      JSON.stringify({
        format: MESTOLO_FORMAT,
        recipe: {
          id: 'abc',
          owner_id: 'someone',
          visibility: 'public',
          title: '  Pasta al pomodoro ',
          description: 'Semplice',
          original_language: 'it',
          servings: 4,
          prep_minutes: 10,
          cook_minutes: -5,
          ingredients: [ing('Spaghetti'), ing('Pomodoro')],
          steps: [step('Cuoci la pasta')],
          tags: ['Veloce', 'veloce', ''],
          category: { slug: 'first-courses' },
          source: { url: 'https://example.com/pasta', name: 'Example' },
          diet_hints_unverified: ['vegan', 'keto', 'vegetarian'],
        },
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.drafts).toHaveLength(1);
    const d = res.drafts[0];
    expect(d.content.title).toBe('Pasta al pomodoro');
    expect(d.content.category_slug).toBe('first-courses');
    expect(d.content.cook_minutes).toBeNull();
    expect(d.content.tags).toEqual(['veloce']);
    expect(d.source).toMatchObject({ type: 'url', url: 'https://example.com/pasta', method: 'file' });
    // Unknown diets dropped, canonical order kept.
    expect(d.diet_hints).toEqual(['vegetarian', 'vegan']);
    expect(d).not.toHaveProperty('id');
    expect(d).not.toHaveProperty('visibility');
    expect(d.warnings).toEqual([]);
  });

  it('drops invalid ingredients and steps with a warning', () => {
    const res = parseMestoloExport(
      JSON.stringify({
        format: MESTOLO_FORMAT,
        recipe: { title: 'Torta', ingredients: [ing('Farina'), { name: '' }, 'zucchero'], steps: [] },
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.drafts[0];
    expect(d.content.ingredients.map((i) => i.name)).toEqual(['Farina']);
    expect(d.warnings.map((w) => w.code)).toEqual(['partial_content', 'no_steps']);
    expect(d.source.type).toBe('text');
  });

  it('reads an account export with custom categories and personal notes', () => {
    const res = parseMestoloExport(
      JSON.stringify({
        format: ACCOUNT_EXPORT_FORMAT,
        categories: [{ id: 'c1', slug: 'my-own' }],
        recipe_notes: [{ recipe_id: 'r1', body: 'Meno sale' }],
        recipes: [
          { id: 'r1', title: 'Tiramisù', category_id: 'c1', ingredients: [ing('Mascarpone')], steps: [step('Monta')], diet_hints: ['vegetarian'] },
          { id: 'r2', title: '', ingredients: [] },
          { id: 'r3', title: 'Pane', source_url: 'javascript:alert(1)', ingredients: [ing('Farina')], steps: [step('Impasta')] },
        ],
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.skipped).toBe(1);
    expect(res.drafts.map((d) => d.content.title)).toEqual(['Tiramisù', 'Pane']);
    const [tiramisu, pane] = res.drafts;
    expect(tiramisu.personal_note).toBe('Meno sale');
    expect(tiramisu.diet_hints).toEqual(['vegetarian']);
    // A user category is not a system slug: the category is suggested again.
    expect(tiramisu.content.category_slug).not.toBe('my-own');
    expect(pane.source.url).toBeNull();
    expect(pane.source.type).toBe('text');
  });

  it('rejects invalid JSON, other formats and empty files', () => {
    expect(parseMestoloExport('{not json')).toEqual({ ok: false, error: 'invalid_json' });
    expect(parseMestoloExport('[]')).toEqual({ ok: false, error: 'unsupported_format' });
    expect(parseMestoloExport(JSON.stringify({ format: 'other/v1' }))).toEqual({ ok: false, error: 'unsupported_format' });
    expect(parseMestoloExport(JSON.stringify({ format: ACCOUNT_EXPORT_FORMAT, recipes: [] }))).toEqual({ ok: false, error: 'no_recipes' });
    expect(parseMestoloExport(JSON.stringify({ format: MESTOLO_FORMAT, recipe: { title: ' ' } }))).toEqual({ ok: false, error: 'no_recipes' });
  });

  it('accepts a file with a UTF-8 BOM', () => {
    const res = parseMestoloExport('﻿' + JSON.stringify({ format: MESTOLO_FORMAT, recipe: { title: 'Brodo' } }));
    expect(res.ok).toBe(true);
  });
});
