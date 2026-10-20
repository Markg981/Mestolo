import { LOCALES, type Locale } from '@/i18n/config';

/** Parole funzionali e di cucina molto frequenti, distintive per lingua. */
const KEYWORDS: Record<Locale, string[]> = {
  it: ['ingredienti', 'preparazione', 'procedimento', 'cottura', 'q.b.', 'cucchiaio', 'cucchiai', 'cucchiaino', 'pizzico', 'farina', 'uova', 'burro', 'sale', 'olio', 'mescolare', 'aggiungere', 'minuti', 'persone', 'forno', 'della', 'di'],
  en: ['ingredients', 'directions', 'instructions', 'method', 'cup', 'cups', 'tablespoon', 'tablespoons', 'teaspoon', 'tsp', 'tbsp', 'pinch', 'flour', 'eggs', 'butter', 'salt', 'stir', 'add', 'minutes', 'serves', 'oven', 'the', 'and', 'with'],
  es: ['ingredientes', 'preparación', 'elaboración', 'cucharada', 'cucharadas', 'cucharadita', 'pizca', 'harina', 'huevos', 'mantequilla', 'sal', 'aceite', 'mezclar', 'añadir', 'agregar', 'minutos', 'raciones', 'horno', 'los', 'las', 'con', 'una', 'del'],
  fr: ['ingrédients', 'préparation', 'étapes', 'cuisson', 'cuillère', 'cuillères', 'pincée', 'farine', 'œufs', 'oeufs', 'beurre', 'sel', 'huile', 'mélanger', 'ajouter', 'minutes', 'personnes', 'four', 'les', 'des', 'avec', 'une', 'le'],
  de: ['zutaten', 'zubereitung', 'anleitung', 'esslöffel', 'teelöffel', 'prise', 'mehl', 'eier', 'butter', 'salz', 'öl', 'rühren', 'hinzufügen', 'minuten', 'portionen', 'backofen', 'und', 'mit', 'der', 'die', 'das', 'ein'],
  pt: ['ingredientes', 'preparo', 'preparação', 'colher', 'colheres', 'pitada', 'farinha', 'ovos', 'manteiga', 'sal', 'óleo', 'misturar', 'adicionar', 'minutos', 'porções', 'forno', 'os', 'as', 'com', 'uma', 'do', 'da'],
};

const INDEX = Object.fromEntries(LOCALES.map((l) => [l, new Set(KEYWORDS[l])])) as Record<Locale, Set<string>>;

/**
 * Rilevamento leggero della lingua di una ricetta incollata, tra le lingue
 * dell'interfaccia. Conta le parole chiave per lingua; se non c'è un vincitore
 * netto (punteggio minimo o pareggio) restituisce `fallback`.
 */
export function detectRecipeLanguage(text: string, fallback: Locale): Locale {
  const words = text.toLowerCase().match(/[\p{L}.]+/gu) ?? [];
  const scores = Object.fromEntries(LOCALES.map((l) => [l, 0])) as Record<Locale, number>;
  for (const w of words) {
    const clean = w.replace(/\.$/, '');
    for (const l of LOCALES) if (INDEX[l].has(w) || INDEX[l].has(clean)) scores[l]++;
  }
  const [best, second] = [...LOCALES].sort((a, b) => scores[b] - scores[a]);
  if (scores[best] < 2 || scores[best] === scores[second]) return fallback;
  return best;
}
