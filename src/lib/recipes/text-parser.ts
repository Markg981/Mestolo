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
const SERVINGS_RE = /(?:per|for|para|pour|für|serves|dosi per|porzioni|servings?|yield|rende|raciones|portions?|portionen|porções|rendimento)\D{0,12}(\d+(?:[.,]\d+)?)(?!\d)(?!\s*(?:min|sec|or[ae]\b|h\b|hours?|hrs?\b|giorn|days?|°|gradi|%))|(\d+(?:[.,]\d+)?)\s*(?:persone|porzioni|servings|people|personas|raciones|personnes|portions|portionen|personen|porções|pessoas|pax)\b/i;
const PREP_RE = /^(?:tempo di )?(?:preparazione|prep(?:aration)?(?: time)?|preparación|préparation|zubereitung(?:szeit)?|vorbereitung|preparo|preparação)\s*[:\-–]\s*(.+)$/i;
const COOK_RE = /^(?:tempo di )?(?:cottura|cook(?:ing)?(?: time)?|cocción|cuisson|garzeit|backzeit|kochzeit|cozedura|cozimento)\s*[:\-–]\s*(.+)$/i;
const TOTAL_RE = /^(?:tempo totale|total(?: time)?|tiempo total|temps total|gesamtzeit|tempo total)\s*[:\-–]\s*(.+)$/i;
const STEP_PREFIX = /^\s*(?:(?:step|passo|passaggio|paso|étape|schritt|passo)\s*)?\d{1,2}\s*(?:[.):](?!\d)|[\-–](?!\s*\d|(?:min|minut\p{L}*|ore|ora|sec|secondi|h|hours?|minutes?)\b))\s*/iu;

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

const NOTES_HEADERS = /^(?:consigli|note|suggerimenti|curiosità|notes?|tips?|consejos|notas|conseils|astuces|hinweise|tipps|dicas)\b[\s:]*$/i;
/** Sub-heading inside ingredients or steps: "Per la frittura", "Per la salsa:", "For the dough". */
const SECTION_RE = /^(?:per|for|para|pour|für|zum|zur)\s+\p{L}/iu;

function isSectionHeader(line: string): boolean {
  if (line.length > 50 || /[.!?;,]$/.test(line) || !/^\p{Lu}/u.test(line)) return false;
  if (!SECTION_RE.test(line) && !/^[^:]{2,40}:$/.test(line)) return false;
  return parseIngredientLine(line.replace(/:$/, '')).quantity === null;
}

/** Header words also matched with one OCR misread ("Preparzione", "Ingredenti"); short words are too ambiguous. */
const INGREDIENT_WORDS = ['ingredienti', 'ingredients', 'ingredientes', 'ingrédients', 'occorrente'];
const STEP_WORDS = ['procedimento', 'preparazione', 'istruzioni', 'esecuzione', 'directions', 'instructions', 'preparation', 'preparación', 'elaboración', 'instrucciones', 'préparation', 'zubereitung', 'anleitung', 'preparação', 'instruções'];

function fuzzyHeader(line: string, words: string[], maxWords: number): boolean {
  const tokens = line.replace(/:$/, '').split(/\s+/);
  const first = tokens[0].replace(/:$/, '').toLowerCase();
  if (tokens.length > maxWords || first.length < 7) return false;
  return words.some((w) => Math.abs(w.length - first.length) <= 2 && editDistance(first, w) <= (w.length >= 10 ? 2 : 1));
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Content on the same line as a header, after the colon: "Ingredienti: 2 uova" -> "2 uova". */
function headerRest(line: string, re: RegExp): string {
  const m = line.match(re);
  return m && m[0].includes(':') ? line.slice(m[0].length).trim() : '';
}

const isIngredientHeader = (line: string) => INGREDIENT_HEADERS.test(line) || fuzzyHeader(line, INGREDIENT_WORDS, 4);
const isStepHeader = (line: string) =>
  (STEP_HEADERS.test(line) && line.replace(STEP_HEADERS, '').trim().length < 3) || fuzzyHeader(line, STEP_WORDS, 1);

/**
 * A printed card often has a logo or author above the title: when the lines before the body
 * hold an all-caps line of two or more words, that is the title and the short lines above it are
 * dropped. Otherwise the first line is the title, as in pasted text.
 */
function pickTitle(head: string[]): number {
  const i = head.findIndex((l) => l.split(/\s+/).length >= 2 && /\p{Lu}{2}/u.test(l) && !/\p{Ll}/u.test(l));
  return i > 0 && head.slice(0, i).every((l) => l.split(/\s+/).length <= 3) ? i : 0;
}

const BULLET = /^[-–•*]\s/;

/**
 * Appends a wrapped line: "la-" + "sciate" -> "lasciate". Mid-sentence, a capital that looks like
 * its lowercase ("Con" after "tagliate a rondelle") is an OCR case misread.
 */
function joinLines(prev: string, next: string): string {
  const text = !/[.!?:;]$/.test(prev) && /^[COSUVWXZ]\p{Ll}/u.test(next) ? next[0].toLowerCase() + next.slice(1) : next;
  return /\p{Ll}-$/u.test(prev) && /^\p{Ll}/u.test(text) ? prev.slice(0, -1) + text : `${prev} ${text}`;
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
  const ingredientLines: { line: string; section: string | null }[] = [];
  const stepLines: { line: string; section: string | null; gap: boolean }[] = [];
  let gap = false; // a blank line since the previous line
  let section: string | null = null;
  let sectionOpen = false; // the header may wrap: "Per la salsa al pomodoro" + "agrodolce"
  let servings: number | null = null;
  let prep: number | null = null;
  let cook: number | null = null;
  let total: number | null = null;
  const noteLines: { line: string; gap: boolean }[] = [];
  let mode: 'head' | 'ingredients' | 'steps' | 'notes' = 'head';
  let sawHeaders = false;

  for (const [idx, line] of lines.entries()) {
    if (!line) {
      gap = true;
      continue;
    }
    const gapBefore = gap;
    gap = false;

    const prepM = line.match(PREP_RE);
    const cookM = line.match(COOK_RE);
    const totalM = line.match(TOTAL_RE);
    if (prepM && prep === null) { prep = parseHumanDuration(prepM[1]); if (prep !== null) continue; }
    if (cookM && cook === null) { cook = parseHumanDuration(cookM[1]); if (cook !== null) continue; }
    if (totalM && total === null) { total = parseHumanDuration(totalM[1]); if (total !== null) continue; }

    const wasOpen = sectionOpen;
    sectionOpen = false;
    if (isIngredientHeader(line)) {
      mode = 'ingredients';
      sawHeaders = true;
      section = SECTION_RE.test(line) ? line.replace(/:$/, '') : null;
      const after = INGREDIENT_HEADERS.test(line) ? line.replace(INGREDIENT_HEADERS, '').trim() : line.split(/\s+/).slice(1).join(' ');
      const rest = headerRest(line, INGREDIENT_HEADERS);
      if (rest) ingredientLines.push({ line: rest, section });
      const sv = after.match(SERVINGS_RE);
      if (sv && servings === null) servings = Number((sv[1] ?? sv[2]).replace(',', '.'));
      continue;
    }
    if (isStepHeader(line) || headerRest(line, STEP_HEADERS)) {
      mode = 'steps';
      sawHeaders = true;
      section = null;
      const rest = headerRest(line, STEP_HEADERS);
      if (rest) stepLines.push({ line: rest, section: null, gap: false });
      continue;
    }
    if (NOTES_HEADERS.test(line) && mode !== 'head') {
      mode = 'notes';
      continue;
    }
    if (mode === 'ingredients' || mode === 'steps') {
      // In prose a wrapped line can start with "Per ...": a heading is followed by a new sentence
      const next = lines.slice(idx + 1).find(Boolean) ?? '';
      if (isSectionHeader(line) && (mode === 'ingredients' || !/^\p{Ll}/u.test(next))) {
        section = line.replace(/:$/, '');
        sectionOpen = true;
        continue;
      }
      // only a single word followed by a quantity line, so "Per la finitura" + "prezzemolo" stays an ingredient
      if (wasOpen && section && /^\p{Ll}[\p{L}']{0,20}$/u.test(line) && looksLikeIngredient(next)) {
        section = `${section} ${line}`;
        continue;
      }
    }

    if (mode === 'head') {
      // the first line is a title candidate, never a servings line
      const sv = line.match(SERVINGS_RE);
      if (descriptionLines.length && sv && servings === null && line.length < 60) {
        servings = Number((sv[1] ?? sv[2]).replace(',', '.'));
        continue;
      }
      descriptionLines.push(line);
    } else if (mode === 'ingredients') {
      ingredientLines.push({ line, section });
    } else if (mode === 'steps') {
      stepLines.push({ line, section, gap: gapBefore });
    } else {
      noteLines.push({ line, gap: gapBefore });
    }
  }

  const titleIdx = pickTitle(descriptionLines);
  title = (descriptionLines[titleIdx] ?? '').replace(/^#+\s*/, '');
  descriptionLines.splice(0, titleIdx + 1);

  // Without headers, split the body into ingredient-like lines and prose.
  if (!sawHeaders && descriptionLines.length) {
    const remaining: string[] = [];
    for (const line of descriptionLines) {
      if (looksLikeIngredient(line)) ingredientLines.push({ line, section: null });
      else if (ingredientLines.length) stepLines.push({ line, section: null, gap: false });
      else remaining.push(line);
    }
    descriptionLines.length = 0;
    descriptionLines.push(...remaining);
  }
  // "Consigli" / "Note" at the end of the card: kept as description, not as steps
  const notes: string[] = [];
  const notesInParagraphs = noteLines.slice(1).some((n) => n.gap);
  for (const { line, gap: g } of noteLines) {
    if (notes.length && notesInParagraphs && !g && !BULLET.test(line)) notes[notes.length - 1] = joinLines(notes[notes.length - 1], line);
    else notes.push(line);
  }
  descriptionLines.push(...notes);

  const ingredients = ingredientLines
    .map(({ line, section: s }) => (s ? { ...parseIngredientLine(line), section: s } : parseIngredientLine(line)))
    .filter((i) => i.name);

  // Merge wrapped lines into steps. When the text marks paragraphs with blank lines (OCR layout,
  // or pasted text), lines with no blank between them are one step whatever their case; a blank
  // line only may end a step, so a lowercase continuation still joins.
  const steps: Step[] = [];
  const inParagraphs = stepLines.slice(1).some((l) => l.gap);
  for (const { line, section: s, gap: g } of stepLines) {
    const numbered = STEP_PREFIX.test(line) || BULLET.test(line);
    const text = line.replace(STEP_PREFIX, '').trim();
    if (!text) continue;
    const prev = steps[steps.length - 1];
    const continues = (inParagraphs && !g) || (/^[a-zàèéìòù]/.test(text) && !/[.!?:]$/.test(prev?.text ?? ''));
    if (prev && !numbered && (prev.section ?? null) === s && continues) {
      prev.text = joinLines(prev.text, text);
    } else {
      steps.push(s ? { text, section: s } : { text });
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
