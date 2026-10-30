import { z } from 'zod';

/**
 * Compatibility of ONE extra ingredient with a tested recipe.
 * The AI rates each criterion 1–5; the overall score is computed HERE, with fixed
 * weights, so it is consistent between requests and never taken as-is from the model.
 */
export const PAIRING_CRITERIA = ['flavor', 'balance', 'texture', 'technique', 'tradition'] as const;
export type PairingCriterion = (typeof PAIRING_CRITERIA)[number];

const WEIGHTS: Record<PairingCriterion, number> = { flavor: 0.35, balance: 0.2, texture: 0.15, technique: 0.2, tradition: 0.1 };

/** A risky addition (baking chemistry, food safety...) never scores above this. */
export const RISKY_CAP = 45;

export type PairingLevel = 'excellent' | 'good' | 'bold' | 'poor';

const link = z.object({ ingredientIndex: z.number().int().nonnegative(), reason: z.string().max(300) });

export const pairingAiSchema = z.object({
  is_food: z.boolean(),
  ingredient: z.string().max(200).default(''),
  already_in_recipe: z.number().int().nonnegative().nullable().default(null),
  criteria: z
    .array(z.object({ key: z.enum(PAIRING_CRITERIA), rating: z.number().min(1).max(5), note: z.string().max(400).default('') }))
    .max(PAIRING_CRITERIA.length)
    .default([]),
  pairs_with: z.array(link).max(8).default([]),
  clashes_with: z.array(link).max(8).default([]),
  role: z.string().max(400).default(''),
  quantity_hint: z.string().max(300).default(''),
  when_to_add: z.string().max(400).default(''),
  stepIndex: z.number().int().nonnegative().nullable().default(null),
  confidence: z.enum(['high', 'medium', 'low']).default('low'),
  risky: z.boolean().default(false),
  warnings: z.array(z.string().max(400)).max(4).default([]),
  summary: z.string().max(500).default(''),
});
export type PairingAi = z.infer<typeof pairingAiSchema>;

export type PairingAssessment = Omit<PairingAi, 'is_food'> & { score: number; level: PairingLevel };

export function pairingScore(criteria: PairingAi['criteria'], risky: boolean): number {
  const total = criteria.reduce((sum, c) => sum + WEIGHTS[c.key] * ((Math.round(c.rating) - 1) / 4), 0);
  const score = Math.round(total * 100);
  return risky ? Math.min(score, RISKY_CAP) : score;
}

export function pairingLevel(score: number): PairingLevel {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'bold';
  return 'poor';
}

/**
 * Validates the model output against the recipe: every criterion exactly once,
 * ingredient/step indexes inside the recipe (others are dropped).
 * Returns null when the output is unusable; 'not_food' when the text is not an ingredient.
 */
export function finalizePairing(ai: PairingAi, counts: { ingredients: number; steps: number }): PairingAssessment | 'not_food' | null {
  if (!ai.is_food) return 'not_food';
  const keys = new Set(ai.criteria.map((c) => c.key));
  if (keys.size !== PAIRING_CRITERIA.length || ai.criteria.length !== PAIRING_CRITERIA.length) return null;
  const inRecipe = (list: PairingAi['pairs_with']) =>
    list.filter((l, i) => l.ingredientIndex < counts.ingredients && list.findIndex((x) => x.ingredientIndex === l.ingredientIndex) === i).slice(0, 4);
  const pairs = inRecipe(ai.pairs_with);
  const pairIdx = new Set(pairs.map((l) => l.ingredientIndex));
  const rest: Omit<PairingAi, 'is_food'> & { is_food?: boolean } = { ...ai };
  delete rest.is_food;
  const score = pairingScore(ai.criteria, ai.risky);
  return {
    ...rest,
    criteria: PAIRING_CRITERIA.map((k) => ai.criteria.find((c) => c.key === k)!),
    already_in_recipe: ai.already_in_recipe !== null && ai.already_in_recipe < counts.ingredients ? ai.already_in_recipe : null,
    pairs_with: pairs,
    // lo stesso ingrediente non puo' essere insieme "si sposa" e "stona"
    clashes_with: inRecipe(ai.clashes_with).filter((l) => !pairIdx.has(l.ingredientIndex)),
    stepIndex: ai.stepIndex !== null && ai.stepIndex < counts.steps ? ai.stepIndex : null,
    score,
    level: pairingLevel(score),
  };
}
