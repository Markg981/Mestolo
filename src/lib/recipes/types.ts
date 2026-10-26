import type { NutritionValues } from '@/lib/nutrition';
export const VISIBILITIES = ['private', 'friends', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const RECIPE_SOURCES = ['manual', 'photo', 'url', 'text', 'copy', 'variant'] as const;
export type RecipeSource = (typeof RECIPE_SOURCES)[number];

/** Flags attached to extracted/generated data that the user should check. */
export type FieldFlag = 'missing' | 'low_confidence' | 'ambiguous' | 'ai_estimate';

export interface Ingredient {
  name: string;
  /** null = quantity not specified/not detected. Never invented. */
  quantity: number | null;
  /** upper bound for ranges like "1-2" */
  quantityMax?: number | null;
  /** canonical unit key (see units.ts) or free text; null = no unit */
  unit: string | null;
  note?: string | null;
  section?: string | null;
  /** "q.b." / to taste */
  toTaste?: boolean;
  /** original text as found in the source, for review */
  raw?: string | null;
  flags?: FieldFlag[];
}

export interface Step {
  text: string;
  section?: string | null;
  flags?: FieldFlag[];
}

/** The editable content of a recipe (what versions snapshot). */
export interface RecipeContent {
  title: string;
  description: string;
  original_language: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  ingredients: Ingredient[];
  steps: Step[];
  category_id: string | null;
  tags: string[];
}

/** Per-field review flags, e.g. { servings: ['missing'], cook_minutes: ['ai_estimate'] } */
export type FieldFlags = Record<string, FieldFlag[]>;

export interface RecipeRow extends RecipeContent {
  id: string;
  owner_id: string;
  source_type: RecipeSource;
  source_url: string | null;
  source_name: string | null;
  source_attribution: string | null;
  visibility: Visibility;
  verification_status: 'verified' | 'needs_review';
  field_flags: FieldFlags;
  diet_hints: string[];
  parent_recipe_id: string | null;
  copied_from_recipe_id: string | null;
  original_author_id: string | null;
  original_author_name: string | null;
  version: number;
  content_hash: string;
  is_hidden: boolean;
  public_page_enabled?: boolean;
  public_slug?: string | null;
  /** Aggregati delle valutazioni (mantenuti da trigger): mostrarli solo se showRating(). */
  rating_avg: number | null;
  rating_count: number;
  created_at: string;
  updated_at: string;
}

/** Result of any import path (photo, URL, text) before the user reviews it. */
export interface ImportDraft {
  content: Omit<RecipeContent, 'category_id'> & { category_slug: string | null };
  field_flags: FieldFlags;
  warnings: ImportWarning[];
  source: {
    type: 'photo' | 'url' | 'text';
    url?: string | null;
    name?: string | null;
    attribution?: string | null;
    imageUrl?: string | null;
    method?: 'jsonld' | 'microdata' | 'text' | 'ai' | 'heuristic' | 'file';
  };
  /** diet hints declared by the author (only from a Mestolo export file): never verified */
  diet_hints?: string[];
  /** personal note carried by a Mestolo export file */
  personal_note?: string;
  categoryConfidence?: number;
  /** Per-serving values found in schema.org NutritionInformation (saved with source 'imported'). */
  nutrition?: NutritionValues | null;
}

export interface ImportWarning {
  code:
    | 'missing_page'
    | 'ambiguous_text'
    | 'unreadable'
    | 'low_confidence'
    | 'no_structured_data'
    | 'partial_content'
    | 'invalid_items_dropped'
    | 'paywall_or_js'
    | 'no_ingredients'
    | 'no_steps';
  message?: string;
  page?: number;
}
