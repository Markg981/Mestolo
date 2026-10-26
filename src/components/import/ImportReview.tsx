'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { RecipeEditor } from '../recipes/editor/RecipeEditor';
import { useDraftUser } from '../recipes/editor/DraftUser';
import { stateFromDraft } from '../recipes/editor/convert';
import type { EditorCategory } from '../recipes/editor/types';
import { draftGet, draftNames, draftSet, draftStorageKey, parseDraft, serializeDraft } from '@/lib/drafts';
import { importIdentity } from '@/lib/recipes/import-identity';
import type { ImportDraft } from '@/lib/recipes/types';

export function ImportReview({ draft, categories, draftKey, aside, onBack }: { draft: ImportDraft; categories: EditorCategory[]; draftKey: string; aside?: React.ReactNode; onBack: () => void }) {
  const tu = useTranslations('units');
  const initial = useMemo(() => stateFromDraft(draft, categories, (k) => (tu.has(k) ? tu(k) : k)), [draft, categories, tu]);
  const scopedDraftKey = useMemo(() => `${draftKey}:${importIdentity(initial)}`, [draftKey, initial]);
  const pendingKey = usePendingKey(draftKey);
  // Remember what is being reviewed: after a reload the import page offers it again (and the editor its draft)
  useEffect(() => {
    if (pendingKey) draftSet(pendingKey, serializeDraft(draft, null));
  }, [pendingKey, draft]);
  const forget = () => {
    if (pendingKey) draftSet(pendingKey, null);
  };
  return (
    <RecipeEditor
      mode="review"
      initial={initial}
      categories={categories}
      draftKey={scopedDraftKey}
      source={draft.source}
      warnings={draft.warnings}
      aside={aside}
      categoryAutoSuggested={draft.content.category_slug !== null}
      importedNutrition={draft.nutrition ?? null}
      onBack={() => {
        forget();
        onBack();
      }}
      onSaved={forget}
    />
  );
}

function usePendingKey(draftKey: string): string | null {
  const userId = useDraftUser();
  return userId ? draftStorageKey(userId, draftNames.importPending(draftKey)) : null;
}

/** On mount, hands back the import that was being reviewed before a reload, if any. */
export function useResumeImport(draftKey: string, resume: (draft: ImportDraft) => void) {
  const resumeRef = useRef(resume);
  const pendingKey = usePendingKey(draftKey);
  useEffect(() => {
    if (!pendingKey) return;
    const raw = draftGet(pendingKey);
    if (!raw) return;
    const res = parseDraft<ImportDraft>(raw, {});
    if (res.status === 'ok' && res.state.content) resumeRef.current(res.state);
    else draftSet(pendingKey, null);
  }, [pendingKey]);
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
