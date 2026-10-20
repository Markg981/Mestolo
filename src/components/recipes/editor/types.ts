import type { FieldFlag, FieldFlags, ImportDraft, ImportWarning, Visibility } from '@/lib/recipes/types';

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
  onBack?: () => void;
}
