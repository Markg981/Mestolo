/**
 * Diets shared by the profile preferences and the recipe "diet hints".
 * Hints are declared by the author and are never verified: they must always be shown as such.
 */
export const DIETS = ['vegetarian', 'vegan', 'pescatarian', 'no_pork', 'no_alcohol'] as const;
export type Diet = (typeof DIETS)[number];

export function isDiet(v: unknown): v is Diet {
  return typeof v === 'string' && (DIETS as readonly string[]).includes(v);
}

/** Keeps only known diets, in canonical order, without duplicates. */
export function knownDiets(values: readonly unknown[] | null | undefined): Diet[] {
  const set = new Set((values ?? []).filter(isDiet));
  return DIETS.filter((d) => set.has(d));
}
