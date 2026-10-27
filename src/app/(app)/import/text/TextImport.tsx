'use client';

import { draftNames } from '@/lib/drafts';
import { useEffect, useState } from 'react';
import { SHARED_TEXT_KEY } from '@/lib/import/share-fragment';
import { ImportReview, useResumeImport } from '@/components/import/ImportReview';
import { TextParseBox } from '@/components/import/TextParseBox';
import type { AiStatusProps } from '@/components/recipes/RecipeIslands';
import type { EditorCategory } from '@/components/recipes/editor/types';
import type { ImportDraft } from '@/lib/recipes/types';

export function TextImport({ categories, status, initialText = '' }: { categories: EditorCategory[]; status: AiStatusProps; initialText?: string }) {
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [sharedText, setSharedText] = useState('');
  useResumeImport(draftNames.import('text'), setDraft);
  // Testo condiviso dall'app Android (/share/native): passa da sessionStorage, mai dall'URL.
  useEffect(() => {
    try {
      const t = sessionStorage.getItem(SHARED_TEXT_KEY);
      if (t) {
        sessionStorage.removeItem(SHARED_TEXT_KEY);
        const shared = t.slice(0, 8000);
        queueMicrotask(() => setSharedText(shared));
      }
    } catch {
      // storage non disponibile
    }
  }, []);
  if (draft) return <ImportReview draft={draft} categories={categories} draftKey={draftNames.import('text')} onBack={() => setDraft(null)} />;
  return <TextParseBox key={sharedText ? 'shared' : 'plain'} initialText={sharedText || initialText} status={status} onDraft={setDraft} />;
}
