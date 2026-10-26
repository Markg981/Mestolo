import * as cheerio from 'cheerio';
import { parseIngredientLine } from '@/lib/recipes/ingredient-parser';
import { parseIsoDuration, parseHumanDuration } from '@/lib/recipes/duration';
import { parseRecipeText } from '@/lib/recipes/text-parser';
import { suggestCategory } from '@/lib/recipes/classify';
import { parseSchemaOrgNutrition } from '@/lib/nutrition';
import type { FieldFlags, ImportDraft, ImportWarning, Step } from '@/lib/recipes/types';

type Json = unknown;
type Obj = Record<string, Json>;

function isObj(v: Json): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typesOf(o: Obj): string[] {
  const t = o['@type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}

function safeJsonParse(text: string): Json | null {
  const cleaned = text
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .replace(/^\s*\/\/\s*<!\[CDATA\[/, '')
    .replace(/\/\/\s*\]\]>\s*$/, '')
    .trim()
    .replace(/;\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    // Some sites put raw newlines/tabs inside strings
    try {
      return JSON.parse(cleaned.replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      return null;
    }
  }
}

/** Depth-first search for an object whose @type includes "Recipe". */
export function findRecipeNode(root: Json, depth = 0): Obj | null {
  if (depth > 8 || root === null || root === undefined) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const found = findRecipeNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isObj(root)) return null;
  if (typesOf(root).some((t) => t.toLowerCase() === 'recipe' || t.toLowerCase().endsWith('/recipe'))) return root;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    if (key in root) {
      const found = findRecipeNode(root[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function text(v: Json): string {
  if (typeof v === 'string') return cheerio.load(`<p>${v}</p>`)('p').text().replace(/\s+/g, ' ').trim();
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ');
  if (isObj(v)) return text(v.name ?? v.text ?? '');
  return '';
}

function names(v: Json): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.flatMap(names);
  if (typeof v === 'string') return [text(v)];
  if (isObj(v) && v.name) return [text(v.name)];
  return [];
}

function parseInstructions(v: Json, section: string | null = null): Step[] {
  if (!v) return [];
  if (typeof v === 'string') {
    const t = cheerio.load(`<div>${v.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li)>/gi, '\n')}</div>`)('div').text();
    return t
      .split(/\n+/)
      .map((s) => s.replace(/^\s*\d{1,2}[.)]\s*/, '').trim())
      .filter((s) => s.length > 1)
      .map((s) => ({ text: s, section }));
  }
  if (Array.isArray(v)) return v.flatMap((x) => parseInstructions(x, section));
  if (isObj(v)) {
    const types = typesOf(v).map((t) => t.toLowerCase());
    if (types.includes('howtosection')) {
      return parseInstructions(v.itemListElement ?? v.steps, text(v.name) || section);
    }
    if (v.itemListElement) return parseInstructions(v.itemListElement, section);
    const t = text(v.text ?? v.name ?? '');
    return t ? [{ text: t, section }] : [];
  }
  return [];
}

function parseYield(v: Json): number | null {
  const values = Array.isArray(v) ? v : [v];
  for (const item of values) {
    if (typeof item === 'number' && item > 0) return item;
    if (typeof item === 'string') {
      const m = item.match(/(\d+(?:[.,]\d+)?)/);
      if (m) {
        const n = Number(m[1].replace(',', '.'));
        if (n > 0 && n <= 1000) return n;
      }
    }
  }
  return null;
}

function parseTime(v: Json): number | null {
  if (typeof v !== 'string') return null;
  return parseIsoDuration(v) ?? parseHumanDuration(v);
}

function firstImageUrl(v: Json, base: string): string | null {
  const candidates = Array.isArray(v) ? v : [v];
  for (const c of candidates) {
    const raw = typeof c === 'string' ? c : isObj(c) ? (c.url ?? c.contentUrl) : null;
    if (typeof raw === 'string') {
      try {
        const u = new URL(raw, base);
        if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

const LANG_RE = /^[a-z]{2}/i;

function detectLang($: cheerio.CheerioAPI, node?: Obj): string | null {
  const fromNode = node && typeof node.inLanguage === 'string' ? node.inLanguage : null;
  const raw = fromNode ?? $('html').attr('lang') ?? null;
  const m = raw?.match(LANG_RE);
  return m ? m[0].toLowerCase() : null;
}

function siteName($: cheerio.CheerioAPI, finalUrl: string): string {
  const og = $('meta[property="og:site_name"]').attr('content')?.trim();
  if (og) return og.slice(0, 200);
  try {
    return new URL(finalUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function fromRecipeNode(node: Obj, $: cheerio.CheerioAPI, finalUrl: string, method: 'jsonld' | 'microdata'): ImportDraft {
  const title = text(node.name ?? node.headline ?? '');
  const description = text(node.description ?? '').slice(0, 4000);
  const ingredientsRaw = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : node.recipeIngredient ? [node.recipeIngredient] : Array.isArray(node.ingredients) ? node.ingredients : [])
    .map(text)
    .filter(Boolean);
  const ingredients = ingredientsRaw.map(parseIngredientLine);
  const steps = parseInstructions(node.recipeInstructions);
  const servings = parseYield(node.recipeYield ?? node.yield);
  const prep = parseTime(node.prepTime);
  const cook = parseTime(node.cookTime);
  const total = parseTime(node.totalTime);
  const authors = names(node.author);
  const publisher = names(node.publisher)[0];
  const lang = detectLang($, node) ?? 'it';
  const hints = [...names(node.recipeCategory), ...names(node.recipeCuisine), ...(typeof node.keywords === 'string' ? [node.keywords] : names(node.keywords))];

  const field_flags: FieldFlags = {};
  const warnings: ImportWarning[] = [];
  if (!title) field_flags.title = ['missing'];
  if (servings === null) field_flags.servings = ['missing'];
  if (prep === null) field_flags.prep_minutes = ['missing'];
  if (cook === null) field_flags.cook_minutes = ['missing'];
  if (total === null) field_flags.total_minutes = ['missing'];
  if (!ingredients.length) { field_flags.ingredients = ['missing']; warnings.push({ code: 'no_ingredients' }); }
  if (!steps.length) { field_flags.steps = ['missing']; warnings.push({ code: 'no_steps' }); }

  const cat = suggestCategory({ title, description, ingredients, hints });
  const attribution = [authors.length ? authors.join(', ') : null, publisher && !authors.includes(publisher) ? publisher : null]
    .filter(Boolean)
    .join(' – ');

  return {
    content: {
      title,
      description,
      original_language: lang,
      servings,
      prep_minutes: prep,
      cook_minutes: cook,
      total_minutes: total,
      ingredients,
      steps,
      tags: [],
      category_slug: cat.slug,
    },
    field_flags,
    warnings,
    categoryConfidence: cat.confidence,
    nutrition: parseSchemaOrgNutrition(node.nutrition),
    source: {
      type: 'url',
      url: finalUrl,
      name: siteName($, finalUrl),
      attribution: attribution || null,
      imageUrl: firstImageUrl(node.image, finalUrl),
      method,
    },
  };
}

/** Minimal schema.org microdata reader (itemtype=".../Recipe"). */
function microdataRecipe($: cheerio.CheerioAPI): Obj | null {
  const scope = $('[itemscope][itemtype*="schema.org/Recipe" i]').first();
  if (!scope.length) return null;
  const prop = (name: string) => scope.find(`[itemprop="${name}"]`);
  const val = (el: ReturnType<typeof prop>) =>
    el.attr('content') ?? el.attr('datetime') ?? el.attr('src') ?? el.text().replace(/\s+/g, ' ').trim();
  const many = (name: string) => prop(name).toArray().map((e) => val($(e))).filter(Boolean);
  return {
    '@type': 'Recipe',
    name: val(prop('name').first()),
    description: val(prop('description').first()),
    recipeIngredient: many('recipeIngredient').length ? many('recipeIngredient') : many('ingredients'),
    recipeInstructions: many('recipeInstructions'),
    recipeYield: val(prop('recipeYield').first()),
    prepTime: val(prop('prepTime').first()),
    cookTime: val(prop('cookTime').first()),
    totalTime: val(prop('totalTime').first()),
    image: val(prop('image').first()),
    author: val(prop('author').first()),
    recipeCategory: val(prop('recipeCategory').first()),
  };
}

interface DomNode {
  type: string;
  name?: string;
  data?: string;
  children?: DomNode[];
}

const BLOCK_TAGS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'div', 'tr']);

/** Single linear DOM walk: text nodes, '\n' for <br> and after block elements. */
function collectText(roots: DomNode[]): string {
  const out: string[] = [];
  // Iterative (explicit stack): deep nesting must not overflow the call stack.
  const stack: Array<DomNode | '\n'> = [];
  for (let i = roots.length - 1; i >= 0; i--) stack.push(roots[i]);
  while (stack.length) {
    const n = stack.pop()!;
    if (n === '\n') {
      out.push('\n');
    } else if (n.type === 'text') {
      out.push(n.data ?? '');
    } else if (n.type === 'tag') {
      if (n.name === 'br') {
        out.push('\n');
        continue;
      }
      if (BLOCK_TAGS.has(n.name ?? '')) stack.push('\n');
      const kids = n.children ?? [];
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
  }
  return out.join('');
}

/** Visible main text, used when the page has no structured data. */
export function extractReadableText($: cheerio.CheerioAPI): string {
  $('script, style, noscript, nav, header, footer, aside, form, iframe, svg, [aria-hidden="true"]').remove();
  const root = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body');
  return collectText(root.get())
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 20000);
}

export interface HtmlImportResult {
  draft: ImportDraft | null;
  pageText: string;
}

export function recipeFromHtml(html: string, finalUrl: string): HtmlImportResult {
  const $ = cheerio.load(html);

  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const parsed = safeJsonParse($(el).contents().text());
    const node = parsed ? findRecipeNode(parsed) : null;
    if (node) {
      const draft = fromRecipeNode(node, $, finalUrl, 'jsonld');
      if (draft.content.title || draft.content.ingredients.length) return { draft, pageText: '' };
    }
  }

  const micro = microdataRecipe($);
  if (micro) {
    const draft = fromRecipeNode(micro, $, finalUrl, 'microdata');
    if (draft.content.title && draft.content.ingredients.length) return { draft, pageText: '' };
  }

  const pageTitle = $('meta[property="og:title"]').attr('content') ?? $('title').text() ?? '';
  const lang = detectLang($) ?? 'it';
  const name = siteName($, finalUrl);
  const pageText = extractReadableText($);

  const parsed = parseRecipeText(`${pageTitle.trim()}\n${pageText}`);
  const warnings: ImportWarning[] = [{ code: 'no_structured_data' }, ...parsed.warnings];
  if (pageText.length < 400) warnings.push({ code: 'paywall_or_js' });
  if (!parsed.ingredients.length && !parsed.steps.length) {
    return { draft: null, pageText };
  }
  const cat = suggestCategory({ title: parsed.title, description: parsed.description, ingredients: parsed.ingredients });
  return {
    draft: {
      content: {
        title: parsed.title.slice(0, 200),
        description: '',
        original_language: lang,
        servings: parsed.servings,
        prep_minutes: parsed.prep_minutes,
        cook_minutes: parsed.cook_minutes,
        total_minutes: parsed.total_minutes,
        ingredients: parsed.ingredients.map((i) => ({ ...i, flags: [...new Set([...(i.flags ?? []), 'low_confidence' as const])] })),
        steps: parsed.steps.map((s) => ({ ...s, flags: ['low_confidence' as const] })),
        tags: [],
        category_slug: cat.slug,
      },
      field_flags: parsed.field_flags,
      warnings,
      categoryConfidence: cat.confidence,
      source: { type: 'url', url: finalUrl, name, attribution: null, imageUrl: null, method: 'text' },
    },
    pageText,
  };
}
