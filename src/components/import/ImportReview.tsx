'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { RecipeEditor } from '../recipes/editor/RecipeEditor';
import { stateFromDraft } from '../recipes/editor/convert';
import type { EditorCategory } from '../recipes/editor/types';
import type { ImportDraft } from '@/lib/recipes/types';

export function ImportReview({ draft, categories, draftKey, aside, onBack }: { draft: ImportDraft; categories: EditorCategory[]; draftKey: string; aside?: React.ReactNode; onBack: () => void }) {
  const tu = useTranslations('units');
  const initial = useMemo(() => stateFromDraft(draft, categories, (k) => (tu.has(k) ? tu(k) : k)), [draft, categories, tu]);
  return (
    <RecipeEditor
      mode="review"
      initial={initial}
      categories={categories}
      draftKey={draftKey}
      source={draft.source}
      warnings={draft.warnings}
      aside={aside}
      categoryAutoSuggested={draft.content.category_slug !== null}
      importedNutrition={draft.nutrition ?? null}
      onBack={onBack}
    />
  );
}

export function emptyDraft(type: 'photo' | 'url' | 'text', locale: string, url?: string | null): ImportDraft {
  return {
    content: {
      title: '',
      description: '',
      original_language: locale,
      servings: null,
      prep_minutes: null,
      cook_minutes: null,
      total_minutes: null,
      ingredients: [],
      steps: [],
      tags: [],
      category_slug: null,
    },
    field_flags: {},
    warnings: [],
    source: { type, url: url ?? null, method: 'heuristic' },
  };
}
