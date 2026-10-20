'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link2 } from 'lucide-react';
import { importFromUrl } from '@/app/actions/import';
import { ImportReview } from '@/components/import/ImportReview';
import { TextParseBox } from '@/components/import/TextParseBox';
import type { AiStatusProps } from '@/components/recipes/RecipeIslands';
import type { EditorCategory } from '@/components/recipes/editor/types';
import type { ImportDraft } from '@/lib/recipes/types';
import { Alert, Field, Input, buttonClass } from '@/components/ui';

export function LinkImport({ categories, status, initialUrl = '' }: { categories: EditorCategory[]; status: AiStatusProps; initialUrl?: string }) {
  const t = useTranslations('link');
  const te = useTranslations('errors');
  const [url, setUrl] = useState(initialUrl);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [fallback, setFallback] = useState<{ text: string; reason: 'no_recipe' | 'error' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (target: string) =>
    start(async () => {
      setError(null);
      setFallback(null);
      const res = await importFromUrl(target);
      if (!res.ok) {
        setError(te(res.error));
        setFallback({ text: '', reason: 'error' });
        return;
      }
      if (res.data.draft) setDraft(res.data.draft);
      else setFallback({ text: res.data.pageText, reason: 'no_recipe' });
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(url);
  };

  // A link shared from another app starts the import right away (once).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (initialUrl && !autoStarted.current) {
      autoStarted.current = true;
      run(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  if (draft) return <ImportReview draft={draft} categories={categories} draftKey="mestolo:draft:import-link" onBack={() => setDraft(null)} />;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <Field label={t('urlLabel')} htmlFor="url" hint={t('compat')}>
          <Input id="url" type="url" inputMode="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoComplete="url" />
        </Field>
        <div>
          <button type="submit" disabled={pending || url.trim().length < 8} className={buttonClass('primary', 'lg')}>
            <Link2 aria-hidden className="size-5" />
            {pending ? t('fetching') : t('fetch')}
          </button>
        </div>
        <p className="text-sm text-muted">{t('rights')}</p>
      </form>

      {error && <Alert tone="error">{error}</Alert>}

      {fallback && (
        <section className="flex flex-col gap-3">
          <Alert tone="info" title={fallback.reason === 'no_recipe' ? t('noRecipeTitle') : t('pasteTitle')}>
            {fallback.reason === 'no_recipe' ? t('noRecipe') : t('pasteLead')}
          </Alert>
          <TextParseBox initialText={fallback.text} sourceUrl={url} status={status} onDraft={setDraft} />
        </section>
      )}
    </div>
  );
}
