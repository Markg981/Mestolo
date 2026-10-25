'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { checkDuplicates, saveRecipe } from '@/app/actions/recipes';
import { ImportReview } from '@/components/import/ImportReview';
import { stateFromDraft, toPayload } from '@/components/recipes/editor/convert';
import type { EditorCategory } from '@/components/recipes/editor/types';
import { Alert, Button, Card } from '@/components/ui';
import { MAX_IMPORT_FILE_BYTES, parseMestoloExport } from '@/lib/recipes/import-json';
import type { ImportDraft } from '@/lib/recipes/types';

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Saves a draft as a private recipe, exactly as the review editor would (the server validates it again). */
function bulkPayload(d: ImportDraft, categories: EditorCategory[]) {
  // Units in a Mestolo export are already canonical keys: no label mapping needed.
  const state = stateFromDraft(d, categories, (k) => k);
  return {
    ...toPayload(state, new Map(), { verified: false, review: true }),
    source_type: d.source.type,
    source_url: d.source.url ?? null,
    source_name: d.source.name ?? null,
    source_attribution: d.source.attribution ?? null,
  };
}

export function FileImport({ categories }: { categories: EditorCategory[] }) {
  const t = useTranslations('fileImport');
  const [drafts, setDrafts] = useState<ImportDraft[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; created: number; duplicates: number; failed: number } | null>(null);
  const [running, start] = useTransition();

  async function onFile(file: File | undefined) {
    setError(null);
    setProgress(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_FILE_BYTES) return setError(t('errors.too_large'));
    const res = parseMestoloExport(await file.text());
    if (!res.ok) return setError(t(`errors.${res.error}`));
    setSkipped(res.skipped);
    setDrafts(res.drafts);
    setPicked(res.drafts.length === 1 ? 0 : null);
  }

  function importAll() {
    if (!drafts) return;
    start(async () => {
      const p = { done: 0, created: 0, duplicates: 0, failed: 0 };
      setProgress({ ...p });
      for (const d of drafts) {
        try {
          const dup = await checkDuplicates({ title: d.content.title, source_url: d.source.url ?? null });
          if (dup.some((m) => sameTitle(m.title, d.content.title))) p.duplicates++;
          else if ((await saveRecipe(bulkPayload(d, categories), null)).ok) p.created++;
          else p.failed++;
        } catch {
          p.failed++;
        }
        p.done++;
        setProgress({ ...p });
      }
    });
  }

  if (drafts && picked !== null) {
    return <ImportReview draft={drafts[picked]} categories={categories} draftKey="mestolo:draft:import-file" onBack={() => (drafts.length === 1 ? setDrafts(null) : setPicked(null))} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <label htmlFor="import-file" className="font-semibold">
          {t('fileLabel')}
        </label>
        <p className="text-sm text-muted">{t('fileHint')}</p>
        <input id="import-file" type="file" accept="application/json,.json" disabled={running} onChange={(e) => onFile(e.target.files?.[0])} className="min-h-11" />
        {error && <Alert tone="error">{error}</Alert>}
      </Card>

      {drafts && drafts.length > 1 && (
        <section aria-labelledby="file-recipes" className="flex flex-col gap-3">
          <h2 id="file-recipes" className="text-2xl font-bold">
            {t('found', { count: drafts.length })}
          </h2>
          {skipped > 0 && <Alert tone="warn">{t('skipped', { count: skipped })}</Alert>}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={running} onClick={importAll}>
              {t('importAll')}
            </Button>
            <p className="text-sm text-muted">{t('importAllHint')}</p>
          </div>
          {progress && (
            <Alert tone={progress.done === drafts.length ? (progress.failed ? 'warn' : 'success') : 'info'}>
              <span role="status">{t('progress', { ...progress, total: drafts.length })}</span>
              {progress.done === drafts.length && (
                <>
                  {' '}
                  <Link href="/recipes" className="font-semibold underline underline-offset-4">
                    {t('goToRecipes')}
                  </Link>
                </>
              )}
            </Alert>
          )}
          <ul className="flex flex-col gap-2">
            {drafts.map((d, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3">
                <span className="font-semibold">{d.content.title}</span>
                <Button disabled={running} onClick={() => setPicked(i)}>
                  {t('review')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
