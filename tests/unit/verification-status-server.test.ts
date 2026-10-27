import { describe, expect, it } from 'vitest';
import { cleanEditorPayload, effectiveVerificationStatus, recipeInputSchema } from '@/lib/recipes/schema';

const base = {
  title: 'Torta',
  servings: 4,
  prep_minutes: null,
  cook_minutes: null,
  total_minutes: null,
  ingredients: [{ name: 'Farina', quantity: 200, unit: 'g' }],
  steps: [{ text: 'Mescola' }],
  category_id: null,
  tags: [],
};
const parse = (extra: Record<string, unknown>) => {
  const r = recipeInputSchema.safeParse(cleanEditorPayload({ ...base, ...extra }));
  if (!r.success) throw new Error('payload non valido');
  return r.data;
};

describe('stato di verifica deciso dal server', () => {
  it('rifiuta valori fuori enum', () => {
    expect(recipeInputSchema.safeParse({ ...base, verification_status: 'approved' }).success).toBe(false);
  });
  it('un payload "verified" con flag di campo diventa needs_review', () => {
    expect(effectiveVerificationStatus(parse({ verification_status: 'verified', field_flags: { 'ingredients.0.quantity': ['missing'] } }))).toBe('needs_review');
  });
  it('flag su ingrediente o passaggio impediscono verified', () => {
    expect(effectiveVerificationStatus(parse({ verification_status: 'verified', ingredients: [{ name: 'Farina', quantity: null, flags: ['ai_estimate'] }] }))).toBe('needs_review');
    expect(effectiveVerificationStatus(parse({ verification_status: 'verified', steps: [{ text: 'Cuoci', flags: ['ambiguous'] }] }))).toBe('needs_review');
  });
  it('senza flag resta verified; needs_review richiesto dal client e\' rispettato', () => {
    expect(effectiveVerificationStatus(parse({ verification_status: 'verified' }))).toBe('verified');
    expect(effectiveVerificationStatus(parse({ verification_status: 'needs_review' }))).toBe('needs_review');
  });
});
