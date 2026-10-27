'use client';

import { useActionTransition } from '@/lib/run-action';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { importFromText } from '@/app/actions/import';
import { AiSourceNote, type AiStatusProps } from '../recipes/RecipeIslands';
import { Alert, Button, Textarea } from '../ui';
import type { ImportDraft } from '@/lib/recipes/types';

/** Paste-the-text fallback, shared by the text page and the link page. Free heuristic parsing; AI optional. */
export function TextParseBox({ initialText = '', sourceUrl, status, onDraft }: { initialText?: string; sourceUrl?: string | null; status: AiStatusProps; onDraft: (d: ImportDraft) => void }) {
  const t = useTranslations('textImport');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useActionTransition();

  const run = (useAi: boolean) =>
    start(async () => {
      setError(null);
      try {
        const res = await importFromText(text, useAi, sourceUrl ?? null, locale);
        if (res.ok) onDraft(res.data);
        else setError(te(res.error));
      } catch {
        setError(te('generic'));
      }
    });

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="recipe-text" className="font-semibold">
        {t('label')}
      </label>
      <Textarea id="recipe-text" rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('placeholder')} maxLength={20000} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending || text.trim().length < 10} onClick={() => run(false)}>
          {pending ? t('parsing') : t('parseFree')}
        </Button>
        <Button disabled={pending || text.trim().length < 10 || !status.available} onClick={() => run(true)}>
          {t('parseAi')}
        </Button>
      </div>
      <p className="text-sm text-muted">{t('freeHint')}</p>
      <AiSourceNote status={status} />
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
