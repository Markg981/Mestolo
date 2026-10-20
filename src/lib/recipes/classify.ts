import { UNCATEGORIZED, type SystemCategorySlug } from './categories';
import type { Ingredient } from './types';

/**
 * Keyword-based (non-AI, free) category suggestion. It is deliberately
 * conservative: when the evidence is weak or ambiguous it returns
 * "uncategorized" instead of guessing. The user can always change it.
 */
const KEYWORDS: Record<Exclude<SystemCategorySlug, 'uncategorized'>, string[]> = {
  starters: ['antipasto', 'antipasti', 'bruschetta', 'crostini', 'tartine', 'starter', 'appetizer', 'appetiser', 'entrante', 'aperitivo', 'tapas', 'tapa', 'entrée', 'hors d\'oeuvre', 'amuse-bouche', 'vorspeise', 'entrada', 'petisco', 'carpaccio', 'hummus', 'frittelle'],
  'first-courses': ['primo', 'primi', 'pasta', 'spaghetti', 'penne', 'rigatoni', 'tagliatelle', 'fettuccine', 'lasagna', 'lasagne', 'risotto', 'gnocchi', 'ravioli', 'tortellini', 'linguine', 'bucatini', 'orecchiette', 'minestra', 'minestrone', 'zuppa', 'vellutata', 'soup', 'sopa', 'soupe', 'suppe', 'noodles', 'ramen', 'paella', 'carbonara', 'amatriciana', 'cacio e pepe', 'first course', 'primer plato', 'nudeln', 'massa', 'macarrão'],
  'main-courses': ['secondo', 'secondi', 'arrosto', 'brasato', 'spezzatino', 'cotoletta', 'scaloppine', 'polpette', 'pollo', 'manzo', 'maiale', 'vitello', 'agnello', 'tacchino', 'salmone', 'merluzzo', 'branzino', 'orata', 'baccalà', 'tonno', 'main course', 'main dish', 'entree', 'roast', 'steak', 'chicken', 'beef', 'pork', 'lamb', 'fish', 'segundo plato', 'plat principal', 'hauptgericht', 'braten', 'prato principal', 'frango', 'carne', 'pesce', 'peixe', 'poulet', 'boeuf', 'stew', 'stufato', 'curry'],
  sides: ['contorno', 'contorni', 'side dish', 'side', 'guarnición', 'acompañamiento', 'accompagnement', 'beilage', 'acompanhamento', 'insalata', 'salad', 'ensalada', 'salade', 'salat', 'salada', 'verdure grigliate', 'patate al forno', 'purè', 'mashed potatoes', 'roasted vegetables'],
  desserts: ['dolce', 'dolci', 'torta', 'crostata', 'biscotti', 'tiramisù', 'tiramisu', 'panna cotta', 'budino', 'gelato', 'semifreddo', 'cheesecake', 'muffin', 'brownie', 'brownies', 'cookies', 'cake', 'pie', 'tart', 'dessert', 'postre', 'pastel', 'tarta', 'gâteau', 'tarte', 'kuchen', 'torte', 'nachtisch', 'sobremesa', 'bolo', 'mousse', 'cioccolato', 'chocolate', 'zabaione', 'cannoli', 'sfogliatella', 'pastiera', 'babà', 'crema pasticcera'],
  'bread-baking': ['pane', 'pani', 'focaccia', 'pizza', 'lievitato', 'lievitati', 'lievito madre', 'brioche', 'panettone', 'pandoro', 'colomba', 'bread', 'sourdough', 'loaf', 'baguette', 'pan', 'masa madre', 'pain', 'levain', 'brot', 'brötchen', 'sauerteig', 'pão', 'fermento', 'ciabatta', 'grissini', 'piadina', 'taralli', 'bagel', 'rolls'],
  drinks: ['bevanda', 'bevande', 'cocktail', 'drink', 'smoothie', 'frullato', 'centrifugato', 'limonata', 'tè freddo', 'liquore', 'limoncello', 'beverage', 'lemonade', 'bebida', 'batido', 'boisson', 'getränk', 'bebida', 'sumo', 'succo', 'juice', 'zumo', 'jus', 'saft', 'caffè', 'coffee', 'tisana', 'punch', 'sangria'],
  breakfast: ['colazione', 'breakfast', 'desayuno', 'petit-déjeuner', 'petit déjeuner', 'frühstück', 'pequeno-almoço', 'café da manhã', 'pancake', 'pancakes', 'porridge', 'granola', 'muesli', 'overnight oats', 'french toast', 'crêpes', 'uova strapazzate', 'scrambled eggs', 'omelette'],
  snacks: ['snack', 'spuntino', 'merenda', 'finger food', 'stuzzichini', 'chips', 'crackers', 'popcorn', 'barrette', 'energy balls', 'aperitivo', 'merienda', 'goûter', 'imbiss', 'lanche', 'pretzel'],
  sauces: ['salsa', 'salse', 'sugo', 'pesto', 'ragù', 'ragu', 'besciamella', 'maionese', 'condimento', 'dressing', 'vinaigrette', 'sauce', 'gravy', 'mayonnaise', 'aioli', 'chutney', 'ketchup', 'soße', 'sauce', 'molho', 'dip', 'marinata', 'marinade', 'glassa', 'glaze'],
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALIZED = Object.fromEntries(
  Object.entries(KEYWORDS).map(([k, words]) => [k, [...new Set(words.map(normalize))]]),
) as Record<keyof typeof KEYWORDS, string[]>;

function countMatches(haystack: string, words: string[]): number {
  let n = 0;
  const padded = ` ${haystack} `;
  for (const w of words) {
    if (padded.includes(` ${w} `)) n++;
  }
  return n;
}

export interface CategorySuggestion {
  slug: SystemCategorySlug;
  confidence: number; // 0..1
}

export function suggestCategory(input: {
  title: string;
  description?: string;
  tags?: string[];
  ingredients?: Pick<Ingredient, 'name'>[];
  /** schema.org recipeCategory / recipeCuisine strings, if any */
  hints?: string[];
}): CategorySuggestion {
  const title = normalize(input.title ?? '');
  const hints = normalize((input.hints ?? []).join(' '));
  const tags = normalize((input.tags ?? []).join(' '));
  const desc = normalize(input.description ?? '').slice(0, 600);

  const scores: [SystemCategorySlug, number][] = [];
  for (const [slug, words] of Object.entries(NORMALIZED) as [keyof typeof KEYWORDS, string[]][]) {
    // explicit category declared by the source (schema.org recipeCategory) weighs the most
    const s = countMatches(hints, words) * 6 + countMatches(title, words) * 3 + countMatches(tags, words) * 2 + countMatches(desc, words);
    if (s > 0) scores.push([slug, s]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  if (!scores.length) return { slug: UNCATEGORIZED, confidence: 0 };
  const [best, second] = scores;
  const margin = second ? best[1] - second[1] : best[1];
  // Need a decent score and a clear margin over the runner-up
  if (best[1] < 3 || margin < 2) return { slug: UNCATEGORIZED, confidence: Math.min(0.4, best[1] / 10) };
  return { slug: best[0], confidence: Math.min(0.95, 0.5 + margin / 10) };
}
