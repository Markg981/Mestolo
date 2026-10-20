import { normalizeText } from '@/lib/recipes/duplicates';
import type { Ingredient } from '@/lib/recipes/types';

/**
 * INDICATIVE filter for discovery: hides recipes that obviously conflict with
 * the user's declared preferences (keyword match on ingredient names).
 * It never certifies that a recipe is suitable for a diet or allergy.
 */
const MEAT = ['carne', 'manzo', 'maiale', 'pollo', 'tacchino', 'vitello', 'agnello', 'prosciutto', 'pancetta', 'guanciale', 'salsiccia', 'speck', 'salame', 'bresaola', 'mortadella', 'lardo', 'meat', 'beef', 'pork', 'chicken', 'turkey', 'veal', 'lamb', 'ham', 'bacon', 'sausage', 'carne picada', 'cerdo', 'pollo', 'ternera', 'cordero', 'jamón', 'viande', 'boeuf', 'porc', 'poulet', 'veau', 'agneau', 'jambon', 'lardons', 'fleisch', 'rind', 'schwein', 'hähnchen', 'huhn', 'kalb', 'lamm', 'schinken', 'speck', 'wurst', 'frango', 'porco', 'vaca', 'presunto', 'chouriço'];
const FISH = ['pesce', 'tonno', 'salmone', 'acciughe', 'alici', 'merluzzo', 'baccalà', 'gamberi', 'cozze', 'vongole', 'calamari', 'polpo', 'fish', 'tuna', 'salmon', 'anchovies', 'anchovy', 'cod', 'shrimp', 'prawns', 'mussels', 'clams', 'squid', 'octopus', 'pescado', 'atún', 'salmón', 'anchoas', 'bacalao', 'gambas', 'mejillones', 'poisson', 'thon', 'saumon', 'anchois', 'morue', 'crevettes', 'moules', 'fisch', 'thunfisch', 'lachs', 'sardellen', 'garnelen', 'muscheln', 'peixe', 'atum', 'salmão', 'bacalhau', 'camarão'];
const ANIMAL_PRODUCTS = ['uova', 'uovo', 'latte', 'burro', 'panna', 'formaggio', 'parmigiano', 'mozzarella', 'ricotta', 'yogurt', 'miele', 'egg', 'eggs', 'milk', 'butter', 'cream', 'cheese', 'honey', 'huevo', 'huevos', 'leche', 'mantequilla', 'nata', 'queso', 'miel', 'oeuf', 'oeufs', 'lait', 'beurre', 'crème', 'fromage', 'ei', 'eier', 'milch', 'butter', 'sahne', 'käse', 'honig', 'ovo', 'ovos', 'leite', 'manteiga', 'queijo', 'mel'];
const PORK = ['maiale', 'prosciutto', 'pancetta', 'guanciale', 'salsiccia', 'speck', 'salame', 'mortadella', 'lardo', 'pork', 'ham', 'bacon', 'cerdo', 'jamón', 'chorizo', 'porc', 'jambon', 'lardons', 'schwein', 'schinken', 'porco', 'presunto', 'chouriço'];
const ALCOHOL = ['vino', 'birra', 'rum', 'brandy', 'cognac', 'grappa', 'liquore', 'marsala', 'wine', 'beer', 'vodka', 'whisky', 'liqueur', 'cerveza', 'vin', 'bière', 'wein', 'bier', 'vinho', 'cerveja', 'limoncello', 'amaretto'];

export interface FoodPreferences {
  dietary_preferences: string[];
  avoided_ingredients: string[];
}

function containsAny(names: string[], words: string[]): boolean {
  const hay = names.map((n) => ` ${normalizeText(n)} `);
  return words.some((w) => {
    const nw = ` ${normalizeText(w)} `;
    return hay.some((h) => h.includes(nw));
  });
}

export function conflictsWithPreferences(ingredients: Pick<Ingredient, 'name'>[], prefs: FoodPreferences): boolean {
  const names = ingredients.map((i) => i.name);
  const diets = new Set(prefs.dietary_preferences);
  if ((diets.has('vegetarian') || diets.has('vegan') || diets.has('pescatarian')) && containsAny(names, MEAT)) return true;
  if ((diets.has('vegetarian') || diets.has('vegan')) && containsAny(names, FISH)) return true;
  if (diets.has('vegan') && containsAny(names, ANIMAL_PRODUCTS)) return true;
  if (diets.has('no_pork') && containsAny(names, PORK)) return true;
  if (diets.has('no_alcohol') && containsAny(names, ALCOHOL)) return true;
  if (prefs.avoided_ingredients.length && containsAny(names, prefs.avoided_ingredients)) return true;
  return false;
}

/** Deterministic daily pick: same recipe all day for a user, changes the next day. */
export function pickOfTheDay<T extends { id: string }>(pool: T[], userId: string, isoDate: string): T | null {
  if (!pool.length) return null;
  const key = `${userId}:${isoDate}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[Math.abs(h) % sorted.length];
}
