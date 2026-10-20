import { parseIngredientLine } from './ingredient-parser';
import { parseHumanDuration } from './duration';
import type { FieldFlags, Ingredient, ImportWarning, Step } from './types';

/**
 * Heuristic (non-AI) parser for recipe text pasted by the user or extracted
 * from a web page without structured data. It never invents values: anything
 * it cannot find is left empty and flagged as missing.
 */

const INGREDIENT_HEADERS = /^(?:ingredienti|ingredients?|ingredientes|ingrédients|zutaten|occorrente|per l['’]impasto|per la farcia)\b[\s:]*/i;
const STEP_HEADERS = /^(?:procedimento|preparazione|istruzioni|metodo|esecuzione|steps?|method|directions|instructions|preparation|preparación|elaboración|instrucciones|modo de preparación|préparation|étapes|instructions|zubereitung|anleitung|modo de preparo|preparo|preparação|instruções)\b[\s:]*/i;
const SERVINGS_RE = /(?:per|for|para|pour|für|serves|dosi per|porzioni|servings?|yield|rende|raciones|portions?|portionen|porções|rendimento)\D{0,12}(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:persone|porzioni|servings|people|personas|raciones|personnes|portions|portionen|personen|porções|pessoas|pax)\b/i;
const PREP_RE = /^(?:tempo di )?(?:preparazione|prep(?:aration)?(?: time)?|preparación|préparation|zubereitung(?:szeit)?|vorbereitung|preparo|preparação)\s*[:\-–]\s*(.+)$/i;
const COOK_RE = /^(?:tempo di )?(?:cottura|cook(?:ing)?(?: time)?|cocción|cuisson|garzeit|backzeit|kochzeit|cozedura|cozimento)\s*[:\-–]\s*(.+)$/i;
const TOTAL_RE = /^(?:tempo totale|total(?: time)?|tiempo total|temps total|gesamtzeit|tempo total)\s*[:\-–]\s*(.+)$/i;
const STEP_PREFIX = /^\s*(?:(?:step|passo|passaggio|paso|étape|schritt|passo)\s*)?\d{1,2}\s*[.):\-–]\s*/i;

export interface ParsedText {
  title: string;
  description: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  ingredients: Ingredient[];
  steps: Step[];
  field_flags: FieldFlags;
  warnings: ImportWarning[];
}

function looksLikeIngredient(line: string): boolean {
  if (line.length > 90) return false;
  const parsed = parseIngredientLine(line);
  return parsed.quantity !== null || !!parsed.toTaste;
}

export function parseRecipeText(input: string): ParsedText {
  const lines = input
    .replace(/ /g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim());

  let title = '';
  const descriptionLines: string[] = [];
  const ingredientLines: string[] = [];
  const stepLines: string[] = [];
  let servings: number | null = null;
  let prep: number | null = null;
  let cook: number | null = null;
  let total: number | null = null;
  let mode: 'head' | 'ingredients' | 'steps' = 'head';
  let sawHeaders = false;

  for (const line of lines) {
    if (!line) continue;

    const prepM = line.match(PREP_RE);
    const cookM = line.match(COOK_RE);
    const totalM = line.match(TOTAL_RE);
    if (prepM && prep === null) { prep = parseHumanDuration(prepM[1]); if (prep !== null) continue; }
    if (cookM && cook === null) { cook = parseHumanDuration(cookM[1]); if (cook !== null) continue; }
    if (totalM && total === null) { total = parseHumanDuration(totalM[1]); if (total !== null) continue; }

    if (INGREDIENT_HEADERS.test(line)) {
      mode = 'ingredients';
      sawHeaders = true;
      const after = line.replace(INGREDIENT_HEADERS, '').trim();
      const sv = after.match(SERVINGS_RE);
      if (sv && servings === null) servings = Number((sv[1] ?? sv[2]).replace(',', '.'));
      continue;
    }
    if (STEP_HEADERS.test(line) && line.replace(STEP_HEADERS, '').trim().length < 3) {
      mode = 'steps';
      sawHeaders = true;
      continue;
    }

    if (mode === 'head') {
      if (!title) { title = line.replace(/^#+\s*/, ''); continue; }
      const sv = line.match(SERVINGS_RE);
      if (sv && servings === null && line.length < 60) {
        servings = Number((sv[1] ?? sv[2]).replace(',', '.'));
        continue;
      }
      descriptionLines.push(line);
    } else if (mode === 'ingredients') {
      ingredientLines.push(line);
    } else {
      stepLines.push(line);
    }
  }

  // Without headers, split the body into ingredient-like lines and prose.
  if (!sawHeaders && descriptionLines.length) {
    const remaining: string[] = [];
    for (const line of descriptionLines) {
      if (looksLikeIngredient(line)) ingredientLines.push(line);
      else if (ingredientLines.length) stepLines.push(line);
      else remaining.push(line);
    }
    descriptionLines.length = 0;
    descriptionLines.push(...remaining);
  }

  const ingredients = ingredientLines.map(parseIngredientLine).filter((i) => i.name);

  // Merge wrapped lines into steps
  const steps: Step[] = [];
  for (const line of stepLines) {
    const numbered = STEP_PREFIX.test(line);
    const text = line.replace(STEP_PREFIX, '').trim();
    if (!text) continue;
    const prev = steps[steps.length - 1];
    if (prev && !numbered && /^[a-zàèéìòù]/.test(text) && !/[.!?:]$/.test(prev.text)) {
      prev.text = `${prev.text} ${text}`;
    } else {
      steps.push({ text });
    }
  }

  const field_flags: FieldFlags = {};
  const warnings: ImportWarning[] = [];
  if (!title) field_flags.title = ['missing'];
  if (servings === null) field_flags.servings = ['missing'];
  if (prep === null) field_flags.prep_minutes = ['missing'];
  if (cook === null) field_flags.cook_minutes = ['missing'];
  if (!ingredients.length) { field_flags.ingredients = ['missing']; warnings.push({ code: 'no_ingredients' }); }
  if (!steps.length) { field_flags.steps = ['missing']; warnings.push({ code: 'no_steps' }); }
  if (!sawHeaders) warnings.push({ code: 'low_confidence' });

  return {
    title,
    description: descriptionLines.join('\n').slice(0, 4000),
    servings: servings && servings > 0 ? servings : null,
    prep_minutes: prep,
    cook_minutes: cook,
    total_minutes: total ?? (prep !== null && cook !== null ? null : null),
    ingredients,
    steps,
    field_flags,
    warnings,
  };
}
