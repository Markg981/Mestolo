'use client';

import { useState } from 'react';
import { ImportReview } from '@/components/import/ImportReview';
import { TextParseBox } from '@/components/import/TextParseBox';
import type { AiStatusProps } from '@/components/recipes/RecipeIslands';
import type { EditorCategory } from '@/components/recipes/editor/types';
import type { ImportDraft } from '@/lib/recipes/types';

export function TextImport({ categories, status }: { categories: EditorCategory[]; status: AiStatusProps }) {
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  if (draft) return <ImportReview draft={draft} categories={categories} draftKey="mestolo:draft:import-text" onBack={() => setDraft(null)} />;
  return <TextParseBox status={status} onDraft={setDraft} />;
}
