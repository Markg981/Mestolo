import { describe, expect, it } from 'vitest';
import { bulkImportPayload, toPayload, stateFromDraft } from '@/components/recipes/editor/convert';
import { parseMestoloExport } from '@/lib/recipes/import-json';
import { MESTOLO_FORMAT } from '@/lib/recipes/export';

const clean = () => {
  const res = parseMestoloExport(
    JSON.stringify({
      format: MESTOLO_FORMAT,
      recipe: {
        title: 'Pasta al pomodoro',
        original_language: 'it',
        servings: 4,
        ingredients: [{ name: 'Spaghetti', quantity: 320, unit: 'g', note: null, section: null, raw: null }],
        steps: [{ text: 'Cuoci la pasta', section: null }],
        visibility: 'public',
      },
    }),
  );
  if (!res.ok) throw new Error(res.error);
  return res.drafts[0];
};

describe('bulk import (account export)', () => {
  it('a recipe without flags would otherwise be saved as verified', () => {
    const d = clean();
    expect(toPayload(stateFromDraft(d, [], (k) => k), new Map(), { verified: false, review: true }).verification_status).toBe('verified');
  });

  it('saves every recipe as private and "needs review", since it skips the review screen', () => {
    const p = bulkImportPayload(clean(), []);
    expect(p.verification_status).toBe('needs_review');
    expect(p.visibility).toBe('private');
    expect(p.title).toBe('Pasta al pomodoro');
  });
});
