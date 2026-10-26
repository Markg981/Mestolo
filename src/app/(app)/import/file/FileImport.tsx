'use client';

import { draftNames } from '@/lib/drafts';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { checkDuplicates, saveRecipe } from '@/app/actions/recipes';
import { ImportReview, useResumeImport } from '@/components/import/ImportReview';
import { bulkImportPayload } from '@/components/recipes/editor/convert';
import type { EditorCategory } from '@/components/recipes/editor/types';
import { Alert, Button, Card } from '@/components/ui';
import { MAX_IMPORT_FILE_BYTES, parseMestoloExport } from '@/lib/recipes/import-json';
import { runBulkImport, type BulkProgress } from '@/lib/recipes/bulk-import';
import type { ImportDraft } from '@/lib/recipes/types';

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function FileImport({ categories }: { categories: EditorCategory[] }) {
  const t = useTranslations('fileImport');
  const [drafts, setDrafts] = useState<ImportDraft[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  useResumeImport(draftNames.import('file'), (d) => {
    setDrafts([d]);
    setPicked(0);
  });
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const stopRef = useRef(false);
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
    setSelected(new Set(res.drafts.map((_, i) => i)));
    setPicked(res.drafts.length === 1 ? 0 : null);
  }

  function importAll() {
    if (!drafts || selected.size === 0) return;
    stopRef.current = false;
    const chosen = drafts.filter((_, i) => selected.has(i));
    start(async () => {
      await runBulkImport(chosen, {
        isDuplicate: async (d) => (await checkDuplicates({ title: d.content.title, source_url: d.source.url ?? null })).some((m) => sameTitle(m.title, d.content.title)),
        save: async (d) => (await saveRecipe(bulkImportPayload(d, categories), null)).ok,
        onProgress: setProgress,
        shouldStop: () => stopRef.current,
      });
    });
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  if (drafts && picked !== null) {
    return <ImportReview draft={drafts[picked]} categories={categories} draftKey={draftNames.import('file')} onBack={() => (drafts.length === 1 ? setDrafts(null) : setPicked(null))} />;
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
            <Button variant="primary" disabled={running || selected.size === 0} onClick={importAll}>
              {t('importSelected', { count: selected.size })}
            </Button>
            {running && <Button onClick={() => (stopRef.current = true)}>{t('stop')}</Button>}
            <Button disabled={running} onClick={() => setSelected(selected.size === drafts.length ? new Set() : new Set(drafts.map((_, i) => i)))}>
              {selected.size === drafts.length ? t('selectNone') : t('selectAll')}
            </Button>
            <p className="text-sm text-muted">{t('importAllHint')}</p>
          </div>
          {progress && (
            <Alert tone={running ? 'info' : progress.failed || progress.stopped ? 'warn' : 'success'}>
              <span role="status">{t(progress.stopped ? 'stopped' : 'progress', { done: progress.done, created: progress.created, duplicates: progress.duplicates, failed: progress.failed, total: selected.size })}</span>
              {!running && (
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
                <label className="flex min-h-11 flex-1 items-center gap-3 font-semibold">
                  <input type="checkbox" className="size-5" checked={selected.has(i)} disabled={running} onChange={() => toggle(i)} />
                  {d.content.title}
                </label>
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
