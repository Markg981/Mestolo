import type { Ingredient } from './types';
import { UNIT_DIMENSION } from './units';

const MIN_POSITIVE = 0.01;

/** Countable: no unit or a unit of dimension 'count' (pieces, cloves, slices...). */
function isCountable(unit: string | null): boolean {
  return !unit || UNIT_DIMENSION[unit] === 'count';
}

function round(n: number, unit: string | null): number {
  if (n <= 0) return n;
  if (isCountable(unit)) return Math.max(1, Math.round(n * 2) / 2);
  return Math.max(MIN_POSITIVE, roundPlain(n));
}

function roundPlain(n: number): number {
  if (n >= 100) return Math.round(n);
  if (n >= 10) return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}

/**
 * Linear scaling of quantities for a different number of servings.
 * Quantities that are unknown or "to taste" are left untouched.
 * Units are never converted.
 */
export function scaleIngredients(ingredients: Ingredient[], fromServings: number | null, toServings: number): Ingredient[] {
  if (!fromServings || fromServings <= 0 || !toServings || toServings <= 0 || fromServings === toServings) {
    return ingredients.map((i) => ({ ...i }));
  }
  const factor = toServings / fromServings;
  return ingredients.map((i) => ({
    ...i,
    quantity: i.quantity === null ? null : round(i.quantity * factor, i.unit),
    quantityMax: i.quantityMax ? round(i.quantityMax * factor, i.unit) : i.quantityMax,
  }));
}

export function scaleFactor(fromServings: number | null, toServings: number): number {
  if (!fromServings || fromServings <= 0) return 1;
  return toServings / fromServings;
}
