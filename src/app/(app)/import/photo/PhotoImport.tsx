'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Camera, ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import { importFromPhotos } from '@/app/actions/import';
import { compressImage, MAX_ORIGINAL_BYTES } from '@/lib/images/client-compress';
import { isNativeApp, takeNativePhoto } from '@/lib/native/camera';
import { MAX_PAGE_BYTES, MAX_PHOTO_PAGES, MAX_TOTAL_BYTES } from '@/lib/import/limits';
import { AiSourceNote, type AiStatusProps } from '@/components/recipes/RecipeIslands';
import { ImportReview, emptyDraft } from '@/components/import/ImportReview';
import type { EditorCategory } from '@/components/recipes/editor/types';
import type { ImportDraft } from '@/lib/recipes/types';
import { Alert, Button, buttonClass, cx } from '@/components/ui';

interface Page {
  id: string;
  name: string;
  blob: Blob | null;
  url: string | null;
  error: 'decode' | 'size' | null;
}

let seq = 0;

export function PhotoImport({ categories, status }: { categories: EditorCategory[]; status: AiStatusProps }) {
  const t = useTranslations('photo');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [pages, setPages] = useState<Page[]>([]);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [processing, setProcessing] = useState(0);
  const replaceTarget = useRef<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const [native, setNative] = useState(false);
  useEffect(() => {
    // Detected after mount: the server render never knows whether it runs inside the app
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNative(isNativeApp());
  }, []);

  async function nativeCapture() {
    setError(null);
    try {
      const file = await takeNativePhoto();
      if (file) await addFiles([file]);
    } catch {
      setError(t('cameraError'));
    }
  }

  async function toPage(file: File): Promise<Page> {
    const id = `p${seq++}`;
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) return { id, name: file.name, blob: null, url: null, error: 'decode' };
    if (file.size > MAX_ORIGINAL_BYTES) return { id, name: file.name, blob: null, url: null, error: 'size' };
    try {
      let blob = await compressImage(file, 2000, 0.82);
      if (blob.size > MAX_PAGE_BYTES) blob = await compressImage(file, 1600, 0.7);
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      return { id, name: file.name, blob, url, error: null };
    } catch {
      return { id, name: file.name, blob: null, url: null, error: 'decode' };
    }
  }

  async function addFiles(list: FileList | File[] | null) {
    if (!list?.length) return;
    setError(null);
    setNotice(null);
    const files = Array.from(list);
    const room = MAX_PHOTO_PAGES - pages.length;
    if (files.length > room) setNotice(t('tooMany', { max: MAX_PHOTO_PAGES }));
    const accepted = files.slice(0, Math.max(0, room));
    setProcessing((n) => n + accepted.length);
    for (const f of accepted) {
      const page = await toPage(f);
      setPages((p) => [...p, page]);
      setProcessing((n) => n - 1);
    }
  }

  async function replaceFile(list: FileList | null) {
    const target = replaceTarget.current;
    const f = list?.[0];
    if (!target || !f) return;
    const page = await toPage(f);
    setPages((p) => p.map((x) => (x.id === target ? { ...page, id: target } : x)));
    replaceTarget.current = null;
  }

  const move = (idx: number, dir: -1 | 1) =>
    setPages((p) => {
      const j = idx + dir;
      if (j < 0 || j >= p.length) return p;
      const c = [...p];
      [c[idx], c[j]] = [c[j], c[idx]];
      return c;
    });

  const valid = pages.filter((p) => p.blob);
  const total = valid.reduce((s, p) => s + (p.blob?.size ?? 0), 0);
  const tooBig = total > MAX_TOTAL_BYTES;

  async function shrinkAll() {
    // Second pass with stronger compression to fit the request limit
    const next: Page[] = [];
    for (const p of pages) {
      if (!p.blob) {
        next.push(p);
        continue;
      }
      const file = new File([p.blob], p.name, { type: 'image/jpeg' });
      const blob = await compressImage(file, 1400, 0.65);
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      next.push({ ...p, blob, url });
    }
    setPages(next);
  }

  const extract = () =>
    start(async () => {
      setError(null);
      const fd = new FormData();
      valid.forEach((p, i) => fd.append('pages', new File([p.blob!], `page-${i + 1}.jpg`, { type: 'image/jpeg' })));
      const res = await importFromPhotos(fd);
      if (res.ok) setDraft(res.data);
      else setError(te(res.error));
    });

  const pagesAside = valid.length ? (
    <div className="flex flex-col gap-2">
      <h2 className="font-bold">{t('yourPages')}</h2>
      <p className="text-sm text-muted">{t('compareHint')}</p>
      <ol className="flex flex-col gap-3">
        {valid.map((p, i) => (
          <li key={p.id}>
            <a href={p.url!} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border border-line">
              <img src={p.url!} alt={t('pageN', { n: i + 1 })} className="w-full" />
            </a>
            <span className="text-sm text-muted">{t('pageN', { n: i + 1 })}</span>
          </li>
        ))}
      </ol>
    </div>
  ) : undefined;

  if (draft) {
    return <ImportReview draft={draft} categories={categories} draftKey="mestolo:draft:import-photo" aside={pagesAside} onBack={() => setDraft(null)} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        <label className={buttonClass('primary', 'lg')}>
          <ImagePlus aria-hidden className="size-5" />
          {t('choose')}
          <input type="file" accept="image/*,.heic,.heif" multiple className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </label>
        {native ? (
          <Button size="lg" onClick={nativeCapture}>
            <Camera aria-hidden className="size-5" />
            {t('takePhoto')}
          </Button>
        ) : (
          <label className={buttonClass('secondary', 'lg')}>
            <Camera aria-hidden className="size-5" />
            {t('takePhoto')}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>
      <p className="text-sm text-muted">{t('rules', { max: MAX_PHOTO_PAGES })}</p>
      {notice && <Alert tone="warn">{notice}</Alert>}
      {processing > 0 && <p role="status" className="text-sm text-muted">{t('processing', { n: processing })}</p>}

      <input ref={replaceInput} type="file" accept="image/*,.heic,.heif" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { replaceFile(e.target.files); e.target.value = ''; }} />

      {pages.length > 0 && (
        <section aria-labelledby="pages-h" className="flex flex-col gap-3">
          <h2 id="pages-h" className="text-xl font-bold">
            {t('pagesCount', { n: pages.length, max: MAX_PHOTO_PAGES })}
          </h2>
          <ol className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
            {pages.map((p, idx) => (
              <li key={p.id} className={cx('flex flex-col gap-2 rounded-2xl border bg-surface p-3', p.error ? 'border-tomato/50' : 'border-line')}>
                <div className="flex items-center justify-between">
                  <span className="font-display font-bold">{t('pageN', { n: idx + 1 })}</span>
                </div>
                {p.url ? (
                  <img src={p.url} alt={t('pageN', { n: idx + 1 })} className="aspect-[3/4] w-full rounded-xl object-cover" />
                ) : (
                  <div className="flex aspect-[3/4] items-center justify-center rounded-xl bg-tomato-wash p-3 text-center text-sm font-semibold text-tomato" role="alert">
                    {p.error === 'size' ? t('fileTooBig') : t('decodeFailed')}
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" className="size-10 px-0" aria-label={tc('moveUp')} disabled={idx === 0} onClick={() => move(idx, -1)}>
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="size-10 px-0" aria-label={tc('moveDown')} disabled={idx === pages.length - 1} onClick={() => move(idx, 1)}>
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="size-10 px-0" aria-label={t('replacePage', { n: idx + 1 })} onClick={() => { replaceTarget.current = p.id; replaceInput.current?.click(); }}>
                    <RefreshCw aria-hidden className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto size-10 px-0 text-tomato" aria-label={t('removePage', { n: idx + 1 })} onClick={() => setPages((ps) => ps.filter((x) => x.id !== p.id))}>
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {tooBig && (
        <Alert tone="warn" action={<Button size="sm" onClick={shrinkAll}>{t('shrink')}</Button>}>
          {t('tooBigTotal')}
        </Alert>
      )}

      {valid.length > 0 && (
        <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          {status.keySource && status.available ? (
            <>
              <AiSourceNote status={status} />
              <p className="text-sm text-muted">{t('privacyNote')}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="lg" disabled={pending || tooBig || processing > 0} onClick={extract}>
                  {pending ? t('extracting') : t('extract', { n: valid.length })}
                </Button>
                <Button size="lg" variant="ghost" onClick={() => setDraft(emptyDraft('photo', locale))}>
                  {t('manualEntry')}
                </Button>
              </div>
              {pending && <p role="status" className="text-sm text-muted">{t('extractingHint')}</p>}
            </>
          ) : (
            <Alert
              tone="info"
              title={t('noProviderTitle')}
              action={
                <>
                  <Button variant="primary" onClick={() => setDraft(emptyDraft('photo', locale))}>
                    {t('manualEntry')}
                  </Button>
                  <Link href="/import/text" className={buttonClass('secondary')}>
                    {t('pasteInstead')}
                  </Link>
                  <Link href="/settings/ai" className={buttonClass('ghost')}>
                    {t('configure')}
                  </Link>
                </>
              }
            >
              {status.keySource === 'app' ? t('quotaReached') : t('noProvider')}
            </Alert>
          )}
          {error && (
            <Alert tone="error" action={<Button size="sm" onClick={extract} disabled={pending}>{tc('retry')}</Button>}>
              {error} {t('pagesKept')}
            </Alert>
          )}
        </section>
      )}
    </div>
  );
}
