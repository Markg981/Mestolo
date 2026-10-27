'use client';

import { useActionTransition } from '@/lib/run-action';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Camera, CheckCircle2, ImagePlus, Trash2 } from 'lucide-react';
import { createCookLog, deleteCookLog, setCookLogVisibility } from '@/app/actions/cooklogs';
import { compressImage, MAX_ORIGINAL_BYTES } from '@/lib/images/client-compress';
import { isNativeApp, takeNativePhoto } from '@/lib/native/camera';
import { todayIso } from '@/lib/plan/week';
import { COOK_NOTE_MAX } from '@/lib/cooking/cook-log';
import { Alert, Button, Field, Select, Textarea, Input, buttonClass } from '../ui';
import { LiveMessage, Modal } from '../client-ui';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';

const todayLocal = () => todayIso(new Date(), null);

/** "L'ho cucinata" button + sheet (date, note, optional photo from file or camera, visibility). */
export function CookedItButton({ recipeId, variant = 'secondary', size = 'md', className }: { recipeId: string; variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const t = useTranslations('cookLog');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useActionTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [visibility, setVisibility] = useState<'recipe' | 'private'>('recipe');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [native, setNative] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the native shell is only detectable on the client
    setNative(isNativeApp());
  }, []);
  useEffect(() => {
    if (!photo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- object URL lifecycle follows the selected file
      setPreview(null);
      return;
    }
    const u = URL.createObjectURL(photo);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);

  const openSheet = () => {
    setError(null);
    setDone(null);
    setDate(todayLocal());
    setOpen(true);
  };
  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > MAX_ORIGINAL_BYTES) {
      setError(te('image_too_large'));
      return;
    }
    setError(null);
    setPhoto(f);
  };
  const camera = async () => {
    try {
      pick(await takeNativePhoto());
    } catch {
      setError(te('generic'));
    }
  };

  const submit = () =>
    start(async () => {
      setError(null);
      try {
        const fd = new FormData();
        fd.set('recipeId', recipeId);
        fd.set('note', note);
        fd.set('date', date);
        fd.set('visibility', visibility);
        if (photo) {
          const blob = await compressImage(photo, 2000, 0.85);
          fd.set('file', new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
        }
        const res = await createCookLog(fd);
        if (!res.ok) {
          setError(te(res.error));
          return;
        }
        setOpen(false);
        setNote('');
        setPhoto(null);
        setDone(t('saved'));
        router.refresh();
      } catch {
        setError(te('generic'));
      }
    });

  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={openSheet}>
        <CheckCircle2 aria-hidden className="size-5" />
        {t('button')}
      </Button>
      {done && <LiveMessage message={done} />}
      <Modal open={open} onClose={() => setOpen(false)} title={t('sheetTitle')} closeLabel={tc('close')}>
        <form
          className="flex flex-col gap-4"
          onKeyDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={t('date')} htmlFor="cook-date">
            <Input id="cook-date" type="date" value={date} max={todayLocal()} required onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('note')} hint={t('noteHint')} htmlFor="cook-note">
            <Textarea id="cook-note" rows={3} maxLength={COOK_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">{t('photo')}</p>
            {preview && <img src={preview} alt={t('photoPreview')} className="max-h-48 w-full rounded-xl object-cover" />}
            <div className="flex flex-wrap gap-2">
              {native && (
                <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => void camera()}>
                  <Camera aria-hidden className="size-4" />
                  {t('takePhoto')}
                </Button>
              )}
              <label className={buttonClass('secondary', 'sm')}>
                <ImagePlus aria-hidden className="size-4" />
                {photo ? t('changePhoto') : t('addPhoto')}
                <input ref={fileRef} type="file" accept="image/*" className="sr-only" disabled={pending} onChange={(e) => pick(e.target.files?.[0])} />
              </label>
              {photo && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPhoto(null);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                >
                  {t('removePhoto')}
                </Button>
              )}
            </div>
          </div>
          <Field label={t('visibility')} hint={t(`visibility_${visibility}Hint`)} htmlFor="cook-vis">
            <Select id="cook-vis" value={visibility} onChange={(e) => setVisibility(e.target.value === 'private' ? 'private' : 'recipe')}>
              <option value="recipe">{t('visibility_recipe')}</option>
              <option value="private">{t('visibility_private')}</option>
            </Select>
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !date}>
              {pending ? tc('saving') : t('save')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Delete (author or recipe owner) and, for the author, the privacy toggle of a log. */
export function CookLogControls({ logId, canToggle, visibility }: { logId: string; canToggle: boolean; visibility: 'private' | 'recipe' }) {
  const t = useTranslations('cookLog');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useActionTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(te((res.error ?? 'generic') as 'generic'));
    });
  return (
    <span className="flex flex-wrap items-center gap-2">
      {canToggle && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setCookLogVisibility(logId, visibility === 'private' ? 'recipe' : 'private'))}>
          {visibility === 'private' ? t('makeShared') : t('makePrivate')}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={t('delete')}
        onClick={() => {
          if (window.confirm(t('deleteConfirm'))) run(() => deleteCookLog(logId));
        }}
      >
        <Trash2 aria-hidden className="size-4" />
        {t('delete')}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-tomato">
          {error}
        </span>
      )}
    </span>
  );
}
