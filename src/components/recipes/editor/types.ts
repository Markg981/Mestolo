import type { FieldFlag, FieldFlags, ImportDraft, ImportWarning, Visibility } from '@/lib/recipes/types';
import type { Diet } from '@/lib/recipes/diets';

export interface EditorIngredient {
  key: string;
  name: string;
  quantity: string;
  quantityMax: string;
  unit: string;
  note: string;
  section: string | null;
  toTaste: boolean;
  raw: string | null;
  flags: FieldFlag[];
}

export interface EditorStep {
  key: string;
  text: string;
  section: string | null;
  flags: FieldFlag[];
}

export interface EditorState {
  title: string;
  description: string;
  original_language: string;
  servings: string;
  prep_minutes: string;
  cook_minutes: string;
  total_minutes: string;
  ingredients: EditorIngredient[];
  steps: EditorStep[];
  category_id: string;
  tags: string;
  visibility: Visibility;
  personal_note: string;
  field_flags: FieldFlags;
  /** declared by the author, never verified (optional: drafts saved before it existed lack it) */
  diet_hints?: Diet[];
}

export interface EditorCategory {
  id: string;
  slug: string;
  label: string;
  system: boolean;
}

export interface EditorProps {
  mode: 'new' | 'edit' | 'review';
  recipeId?: string;
  initial: EditorState;
  categories: EditorCategory[];
  draftKey: string;
  source?: ImportDraft['source'];
  warnings?: ImportWarning[];
  /** extra content shown next to the form (e.g. the photographed pages) */
  aside?: React.ReactNode;
  categoryAutoSuggested?: boolean;
  /** per-serving values found by the importer: saved with source 'imported' (editable afterwards) */
  importedNutrition?: import('@/lib/nutrition').NutritionValues | null;
  onBack?: () => void;
}
