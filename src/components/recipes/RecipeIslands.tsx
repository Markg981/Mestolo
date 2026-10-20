'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, Languages, Sparkles, Trash2 } from 'lucide-react';
import { saveNote } from '@/app/actions/recipes';
import { translateRecipe } from '@/app/actions/ai';
import { deleteRecipeImage, generateRecipeImage, uploadRecipeImage } from '@/app/actions/images';
import { compressImage } from '@/lib/images/client-compress';
import { LiveMessage, Modal } from '../client-ui';
import { Alert, Badge, Button, Textarea, buttonClass } from '../ui';
import type { ImageRow } from '@/lib/data/recipes';

export interface AiStatusProps {
  available: boolean;
  keySource: 'user' | 'app' | null;
  providerName: string | null;
  remainingToday: number | null;
  dailyLimit: number | null;
}

/** States clearly whose key a request will use and whether it may cost money. */
export function AiSourceNote({ status }: { status: AiStatusProps }) {
  const t = useTranslations('ai');
  if (!status.keySource) return <p className="text-sm text-muted">{t('notConfigured')}</p>;
  if (status.keySource === 'user') return <p className="text-sm text-muted">{t('usesUserKey', { provider: status.providerName ?? '' })}</p>;
  return (
    <p className="text-sm text-muted">
      {status.available
        ? t('usesAppKey', { provider: status.providerName ?? '', remaining: status.remainingToday ?? 0, limit: status.dailyLimit ?? 0 })
        : t('appQuotaReached', { limit: status.dailyLimit ?? 0 })}
    </p>
  );
}

export function NoteEditor({ recipeId, initial }: { recipeId: string; initial: string }) {
  const t = useTranslations('recipe');
  const te = useTranslations('errors');
  const [value, setValue] = useState(initial);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="pnote" className="text-xl font-bold">
        {t('personalNote')}
      </label>
      <p className="text-sm text-muted">{t('personalNoteHint')}</p>
      <Textarea id="pnote" rows={3} maxLength={10000} value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('notePlaceholder')} />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={pending || value === initial}
          onClick={() =>
            start(async () => {
              const res = await saveNote(recipeId, value);
              setMsg(res.ok ? { text: t('noteSaved'), tone: 'success' } : { text: te(res.error), tone: 'error' });
            })
          }
        >
          {t('saveNote')}
        </Button>
        <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
      </div>
    </div>
  );
}

export function TranslateBanner({ recipeId, fromName, toName, target, status, showing }: { recipeId: string; fromName: string; toName: string; target: string; status: AiStatusProps; showing: 'original' | 'translation' | 'stale' }) {
  const t = useTranslations('translate');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (showing === 'translation') {
    return (
      <Alert tone="info" title={t('machineLabel', { language: toName })} action={<Link href={`/recipes/${recipeId}`} className={buttonClass('secondary', 'sm')}>{t('showOriginal', { language: fromName })}</Link>}>
        {t('machineNote')}
      </Alert>
    );
  }
  return (
    <div className="no-print flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center">
      <Languages aria-hidden className="size-6 shrink-0 text-basil" />
      <div className="flex-1">
        <p className="font-semibold">{showing === 'stale' ? t('stale') : t('banner', { language: fromName })}</p>
        <AiSourceNote status={status} />
        {error && <p className="text-sm font-semibold text-tomato" role="alert">{error}</p>}
      </div>
      {status.available ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await translateRecipe(recipeId, target);
              if (res.ok) {
                router.push(`/recipes/${recipeId}?lang=${target}`);
                router.refresh();
              } else setError(te(res.error));
            })
          }
        >
          {pending ? t('translating') : t('translateTo', { language: toName })}
        </Button>
      ) : (
        <Link href="/settings/ai" className={buttonClass('ghost', 'sm')}>
          {t('configure')}
        </Link>
      )}
    </div>
  );
}

async function uploadFile(recipeId: string, file: File, alt: string) {
  const blob = await compressImage(file, 2000, 0.85);
  const fd = new FormData();
  fd.set('recipeId', recipeId);
  fd.set('file', new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
  fd.set('alt', alt);
  return uploadRecipeImage(fd);
}

/** Owner-only prompt shown when a recipe has no image: upload, or generate ONLY after explicit confirmation. */
export function ImagePrompt({ recipeId, title, status }: { recipeId: string; title: string; status: AiStatusProps }) {
  const t = useTranslations('image');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="no-print flex flex-col gap-3 rounded-2xl border border-dashed border-line bg-surface p-4">
      <p className="font-semibold">{t('question')}</p>
      <p className="text-sm text-muted">{t('questionLead')}</p>
      <div className="flex flex-wrap gap-2">
        <label className={buttonClass('secondary', 'sm')}>
          <ImagePlus aria-hidden className="size-4" />
          {t('upload')}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              start(async () => {
                setError(null);
                try {
                  const res = await uploadFile(recipeId, f, title);
                  if (res.ok) router.refresh();
                  else setError(te(res.error));
                } catch {
                  setError(te('image_invalid'));
                }
              });
            }}
          />
        </label>
        <Button size="sm" onClick={() => setOpen(true)} disabled={pending}>
          <Sparkles aria-hidden className="size-4" />
          {t('generate')}
        </Button>
      </div>
      {pending && <p className="text-sm text-muted" role="status">{t('working')}</p>}
      {error && <p className="text-sm font-semibold text-tomato" role="alert">{error}</p>}
      <Modal open={open} onClose={() => setOpen(false)} title={t('confirmTitle')} closeLabel={tc('close')}>
        {status.keySource ? (
          <>
            <p>{t('confirmLead')}</p>
            <AiSourceNote status={status} />
            <p className="text-sm text-muted">{status.keySource === 'user' ? t('costUser') : t('costApp')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={pending || !status.available}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const res = await generateRecipeImage(recipeId, true);
                    setOpen(false);
                    if (res.ok) router.refresh();
                    else setError(te(res.error));
                  })
                }
              >
                {pending ? t('generating') : t('confirmGenerate')}
              </Button>
              <Button onClick={() => setOpen(false)}>{tc('cancel')}</Button>
            </div>
          </>
        ) : (
          <>
            <p>{t('notConfigured')}</p>
            <Link href="/settings/ai" className={buttonClass('secondary')}>
              {t('configure')}
            </Link>
          </>
        )}
      </Modal>
    </div>
  );
}

/** Image management on the edit page. */
export function ImageManagerClient({ recipeId, title, images }: { recipeId: string; title: string; images: ImageRow[] }) {
  const t = useTranslations('image');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-2xl font-bold">{t('manageTitle')}</h2>
      <p className="text-sm text-muted">{t('privacyHint')}</p>
      <div className="flex flex-wrap gap-3">
        {images.map((img) => (
          <figure key={img.id} className="flex w-40 flex-col gap-1">
            <img src={`/api/images/${img.id}?size=thumb`} alt={img.alt_text} className="h-28 w-40 rounded-xl object-cover" loading="lazy" />
            <figcaption className="flex flex-wrap items-center gap-1 text-xs">
              {img.kind === 'ai_generated' && <Badge>{t('aiLabel')}</Badge>}
              {img.kind === 'imported' && <Badge>{t('importedLabel')}</Badge>}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto size-9 px-0 text-tomato"
                aria-label={t('delete')}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await deleteRecipeImage(img.id);
                    if (res.ok) router.refresh();
                    else setError(te(res.error));
                  })
                }
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </figcaption>
          </figure>
        ))}
      </div>
      <div>
        <label className={buttonClass('secondary')}>
          <ImagePlus aria-hidden className="size-5" />
          {pending ? tc('loading') : t('upload')}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              start(async () => {
                setError(null);
                try {
                  const res = await uploadFile(recipeId, f, title);
                  if (res.ok) router.refresh();
                  else setError(te(res.error));
                } catch {
                  setError(te('image_invalid'));
                }
              });
            }}
          />
        </label>
      </div>
      {error && <p className="text-sm font-semibold text-tomato" role="alert">{error}</p>}
    </section>
  );
}
