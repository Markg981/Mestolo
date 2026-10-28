'use client';

import { useActionTransition } from '@/lib/run-action';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { saveRecipe, checkDuplicates } from '@/app/actions/recipes';
import { uploadRecipeImage, importSourceImage } from '@/app/actions/images';
import { createCategory } from '@/app/actions/organize';
import { parseIngredientLines } from '@/lib/recipes/ingredient-parser';
import { suggestCategory } from '@/lib/recipes/classify';
import { RECIPE_LIMITS } from '@/lib/recipes/schema';
import { DIETS } from '@/lib/recipes/diets';
import { UNIT_KEYS } from '@/lib/recipes/units';
import { RECIPE_LANGUAGES } from '@/i18n/config';
import { compressImage } from '@/lib/images/client-compress';
import type { DuplicateMatch } from '@/lib/recipes/duplicates';
import type { FieldFlag, Visibility } from '@/lib/recipes/types';
import { Alert, Badge, Button, Field, Input, Select, Textarea, buttonClass, cx, inputClass } from '../../ui';
import { clearLegacyDrafts, draftGet, draftSet, draftStorageKey, parseDraft, readDraftKey, serializeDraft } from '@/lib/drafts';
import { useDraftUser } from './DraftUser';
import { createSaveGuard, emptyIngredient, emptyStep, invalidQuantityIngredients, toEditorIngredient, toPayload } from './convert';
import type { EditorIngredient, EditorProps, EditorState, EditorStep } from './types';

function FlagBadges({ flags }: { flags?: FieldFlag[] }) {
  const t = useTranslations('flags');
  if (!flags?.length) return null;
  return (
    <>
      {flags.map((f) => (
        <Badge key={f} tone={f === 'ai_estimate' ? 'neutral' : 'saffron'}>
          {t(f)}
        </Badge>
      ))}
    </>
  );
}

export function RecipeEditor({ mode, recipeId, initial, categories, draftKey, baseVersion, expectedVersion, source, warnings, aside, categoryAutoSuggested, importedNutrition, onBack, onSaved }: EditorProps) {
  const t = useTranslations('editor');
  const tc = useTranslations('common');
  const tu = useTranslations('units');
  const tv = useTranslations('visibility');
  const tw = useTranslations('warnings');
  const te = useTranslations('errors');
  const fieldLabel = (path: string) => {
    const [head, idx] = path.split('.');
    const n = /^\d+$/.test(idx ?? '') ? ` ${Number(idx) + 1}` : '';
    const label = head === 'ingredients' ? t('ingredientName') : head === 'steps' ? t('steps') : head === 'title' ? t('title') : head;
    return `${label}${n}`;
  };
  const tCat = useTranslations('categories');
  const ts = useTranslations('settings');
  const locale = useLocale();
  const router = useRouter();
  const draftUserId = useDraftUser();
  const storageKey = draftUserId ? draftStorageKey(draftUserId, draftKey) : null;

  const [s, setS] = useState<EditorState>(initial);
  const [restored, setRestored] = useState(false);
  // draft started from an older server version (recipe saved in another tab/device): offered, never dropped silently
  const [conflictDraft, setConflictDraft] = useState<EditorState | null>(null);
  const [notStored, setNotStored] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useActionTransition();
  // a double submit or retry of a creation returns the same recipe; the key is persisted in the draft so it survives remounts
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  // set once the recipe is saved: from then on no autosave may recreate the draft
  const savedRef = useRef(false);
  const saveGuard = useRef(createSaveGuard());
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [keepSourceImage, setKeepSourceImage] = useState(false);
  const [bulk, setBulk] = useState('');
  const [newCat, setNewCat] = useState('');
  const [cats, setCats] = useState(categories);
  const [userPickedCategory, setUserPickedCategory] = useState(mode === 'edit' || !!initial.category_id);
  const [autoSuggested, setAutoSuggested] = useState(!!categoryAutoSuggested);
  const firstRender = useRef(true);

  const unitLabelToKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of UNIT_KEYS) {
      m.set(tu(k).toLowerCase(), k);
      m.set(k, k);
    }
    return m;
  }, [tu]);

  const langNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'language' });
    } catch {
      return null;
    }
  }, [locale]);

  // Restore an unsaved draft (protects against errors, reloads, closed tabs)
  useEffect(() => {
    clearLegacyDrafts();
    if (!storageKey) return;
    const raw = draftGet(storageKey);
    if (!raw) return;
    const storedKey = readDraftKey(raw);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (storedKey) setIdempotencyKey(storedKey);
    // In edit mode the draft is restored directly only if it started from the current server version.
    const res = parseDraft<EditorState>(raw, { serverVersion: mode === 'edit' ? (baseVersion ?? '') : null });
    if (res.status === 'conflict') {
      // Restoring from browser storage (an external system) once on mount; the user decides whether to apply it.
      if (JSON.stringify(res.state) !== JSON.stringify(initial)) setConflictDraft(res.state);
      return;
    }
    if (res.status !== 'ok') {
      draftSet(storageKey, null);
      return;
    }
    if (JSON.stringify(res.state) !== JSON.stringify(initial)) {
      setS(res.state);
      setRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Autosave
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // A pending conflict draft stays untouched in storage until the user restores or discards it.
    if (!storageKey || conflictDraft) return;
    let pending = true;
    const write = () => {
      if (!pending || savedRef.current) return;
      pending = false;
      setNotStored(!draftSet(storageKey, serializeDraft(s, baseVersion, Date.now(), idempotencyKey)));
    };
    const id = setTimeout(write, 500);
    // Tab hidden or closed before the debounce fires: write now so the last edits are not lost.
    const onHide = () => {
      if (document.visibilityState === 'hidden') write();
    };
    window.addEventListener('pagehide', write);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pagehide', write);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [s, storageKey, baseVersion, conflictDraft, idempotencyKey]);

  // Possible duplicates (new recipes and imports)
  useEffect(() => {
    if (mode === 'edit' || s.title.trim().length < 3) return;
    let stale = false; // risposta obsoleta: l'effetto e stato ripulito (E-09)
    const id = setTimeout(async () => {
      try {
        const res = await checkDuplicates({ title: s.title, source_url: source?.url ?? null, ingredients: s.ingredients.map((i) => ({ name: i.name })) }, recipeId);
        if (!stale) setDuplicates(res);
      } catch {
        // fallback silenzioso: il controllo duplicati e solo un suggerimento
      }
    }, 700);
    return () => {
      stale = true;
      clearTimeout(id);
    };
  }, [s.title, s.ingredients, mode, source?.url, recipeId]);

  // Category suggestion while typing (manual creation): derived, never overrides a user choice
  const suggestedCategoryId = useMemo(() => {
    if (userPickedCategory || mode !== 'new' || s.title.trim().length < 4) return null;
    const sug = suggestCategory({ title: s.title, description: s.description, ingredients: s.ingredients });
    return cats.find((c) => c.system && c.slug === sug.slug)?.id ?? null;
  }, [userPickedCategory, mode, s.title, s.description, s.ingredients, cats]);
  const effectiveCategoryId = suggestedCategoryId ?? s.category_id;
  const showSuggestedHint = (!!suggestedCategoryId && !userPickedCategory) || autoSuggested;
  const duplicatesShown = mode === 'edit' || s.title.trim().length < 3 ? [] : duplicates;

  const set = <K extends keyof EditorState>(key: K, value: EditorState[K], clearFlag?: string) =>
    setS((p) => {
      const next = { ...p, [key]: value };
      if (clearFlag && p.field_flags[clearFlag]) {
        const ff = { ...p.field_flags };
        delete ff[clearFlag];
        next.field_flags = ff;
      }
      return next;
    });

  const updIng = (key: string, patch: Partial<EditorIngredient>) =>
    setS((p) => ({
      ...p,
      ingredients: p.ingredients.map((i) => (i.key === key ? { ...i, ...patch, flags: patch.flags ?? i.flags.filter((f) => f === 'ai_estimate' ? true : false) } : i)),
      field_flags: (() => {
        const ff = { ...p.field_flags };
        delete ff.ingredients;
        return ff;
      })(),
    }));
  const updStep = (key: string, text: string) =>
    setS((p) => ({
      ...p,
      steps: p.steps.map((x) => (x.key === key ? { ...x, text, flags: [] } : x)),
      field_flags: (() => {
        const ff = { ...p.field_flags };
        delete ff.steps;
        return ff;
      })(),
    }));

  function move<T>(list: T[], index: number, dir: -1 | 1): T[] {
    const j = index + dir;
    if (j < 0 || j >= list.length) return list;
    const copy = [...list];
    [copy[index], copy[j]] = [copy[j], copy[index]];
    return copy;
  }

  const addBulk = () => {
    const parsed = parseIngredientLines(bulk).map((i) => toEditorIngredient(i, (k) => tu(k)));
    if (!parsed.length) return;
    setS((p) => ({ ...p, ingredients: [...p.ingredients.filter((i) => i.name.trim()), ...parsed] }));
    setBulk('');
  };

  const onPickImage = (f: File | null) => {
    setImageFile(f);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(f ? URL.createObjectURL(f) : null);
  };

  const addCategory = async () => {
    const name = newCat.trim();
    if (!name) return;
    const res = await createCategory(name);
    if (res.ok) {
      setCats((c) => [...c, { id: res.data.id, slug: '', label: name, system: false }]);
      set('category_id', res.data.id);
      setUserPickedCategory(true);
      setNewCat('');
    } else setError(te(res.error));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saveGuard.current.locked) return;
    setError(null);
    if (!s.title.trim()) {
      setError(t('titleRequired'));
      document.getElementById('title')?.focus();
      return;
    }
    const badQty = invalidQuantityIngredients(s)[0];
    if (badQty) {
      setError(t('quantityInvalid', { name: badQty.name.trim(), value: badQty.quantity.trim() || badQty.quantityMax.trim() }));
      document.getElementById(`q-${badQty.key}`)?.focus();
      return;
    }
    const payload = {
      ...toPayload({ ...s, category_id: effectiveCategoryId }, unitLabelToKey, { verified: mode !== 'review' || verified, review: mode === 'review' }),
      source_type: mode === 'review' ? source?.type ?? 'text' : 'manual',
      source_url: mode === 'review' ? source?.url ?? null : null,
      source_name: mode === 'review' ? source?.name ?? null : null,
      source_attribution: mode === 'review' ? source?.attribution ?? null : null,
      nutrition: mode === 'review' ? importedNutrition ?? null : null,
    };
    startSaving(async () => {
      try {
        const res = await saveGuard.current.run(() => saveRecipe(payload, mode === 'edit' ? recipeId : null, mode === 'edit' ? expectedVersion : null, mode === 'edit' ? null : idempotencyKey));
        if (!res) return;
        if (!res.ok) {
          setError(res.error === 'invalid_input' && res.detail ? te('invalid_input_field', { field: fieldLabel(res.detail) }) : te(res.error));
          return;
        }
        const id = res.data.id;
        const extras: string[] = [];
        if (imageFile) {
          try {
            const blob = await compressImage(imageFile, 2000, 0.85);
            const fd = new FormData();
            fd.set('recipeId', id);
            fd.set('file', new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
            fd.set('alt', s.title);
            const up = await uploadRecipeImage(fd);
            if (!up.ok) extras.push('image');
          } catch {
            extras.push('image');
          }
        }
        if (mode === 'review' && keepSourceImage && source?.imageUrl) {
          // La ricetta è già salvata: un errore (anche un'eccezione) dell'import immagine è solo un avviso.
          try {
            const r = await importSourceImage(id, source.imageUrl, source.name ?? source.attribution ?? null);
            if (!r.ok) extras.push('image');
          } catch {
            extras.push('image');
          }
        }
        savedRef.current = true;
        if (storageKey) draftSet(storageKey, null);
        onSaved?.();
        router.push(`/recipes/${id}${extras.length ? '?image=failed' : mode === 'edit' ? '?saved=1' : '?created=1'}`);
        router.refresh();
      } catch {
        setError(te('generic'));
      }
    });
  };

  const discardDraft = () => {
    if (storageKey) draftSet(storageKey, null);
    setS(initial);
    setRestored(false);
  };

  // Apply the conflicting draft over the current version: the next autosave rebases it on baseVersion
  // and saving overwrites the version saved elsewhere.
  const restoreConflictDraft = () => {
    if (!conflictDraft) return;
    setS(conflictDraft);
    setConflictDraft(null);
    setRestored(true);
  };
  const discardConflictDraft = () => {
    if (storageKey) draftSet(storageKey, null);
    setConflictDraft(null);
  };

  const flaggedCount =
    Object.values(s.field_flags).filter((v) => v.some((f) => f !== 'ai_estimate')).length +
    s.ingredients.filter((i) => i.flags.some((f) => f !== 'ai_estimate')).length +
    s.steps.filter((x) => x.flags.some((f) => f !== 'ai_estimate')).length;

  const timeField = (key: 'prep_minutes' | 'cook_minutes' | 'total_minutes', label: string) => (
    <Field label={label} htmlFor={key} flag={<FlagBadges flags={s.field_flags[key]} />}>
      <div className="flex items-center gap-2">
        <Input id={key} inputMode="numeric" value={s[key]} onChange={(e) => set(key, e.target.value.replace(/[^\d]/g, ''), key)} placeholder={s.field_flags[key]?.includes('missing') ? t('notDetected') : ''} />
        <span className="text-sm text-muted">{tc('minShort')}</span>
      </div>
    </Field>
  );

  return (
    <form onSubmit={submit} className={cx('grid gap-8', aside ? 'lg:grid-cols-[minmax(0,1fr)_22rem]' : '')} noValidate>
      <fieldset disabled={saving} aria-busy={saving} className="m-0 flex min-w-0 flex-col gap-8 border-0 p-0">
        {restored && (
          <Alert tone="info" title={t('draftRestored')} action={<Button size="sm" onClick={discardDraft}>{t('discardDraft')}</Button>} />
        )}
        {conflictDraft && (
          <Alert
            tone="warn"
            title={t('draftConflict')}
            action={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={restoreConflictDraft}>{t('restoreConflictDraft')}</Button>
                <Button size="sm" variant="ghost" onClick={discardConflictDraft}>{t('discardDraft')}</Button>
              </div>
            }
          />
        )}
        {notStored && <Alert tone="warn" title={t('draftNotStored')} />}

        {mode === 'review' && (
          <Alert tone={flaggedCount ? 'warn' : 'info'} title={t('reviewIntroTitle')}>
            <p>{t('reviewIntro')}</p>
            {flaggedCount > 0 && <p className="mt-1 font-semibold">{t('flaggedCount', { count: flaggedCount })}</p>}
            {!!warnings?.length && (
              <ul className="mt-2 list-disc pl-5">
                {warnings.map((w, i) => (
                  <li key={i}>
                    {tw(w.code, { page: w.page ?? '' })}
                    {w.message ? ` — ${w.message}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}

        {mode === 'review' && source && (source.url || source.name || source.attribution) && (
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <h2 className="mb-2 font-bold">{t('sourceBox')}</h2>
            <dl className="grid gap-1 text-[0.97rem] sm:grid-cols-[8rem_1fr]">
              {source.name && (
                <>
                  <dt className="text-muted">{t('sourceName')}</dt>
                  <dd>{source.name}</dd>
                </>
              )}
              {source.attribution && (
                <>
                  <dt className="text-muted">{t('sourceAuthor')}</dt>
                  <dd>{source.attribution}</dd>
                </>
              )}
              {source.url && (
                <>
                  <dt className="text-muted">{t('sourceUrl')}</dt>
                  <dd className="min-w-0">
                    <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 max-w-full items-center gap-1 break-all text-basil underline underline-offset-4">
                      {source.url}
                      <ExternalLink aria-hidden className="size-4 shrink-0" />
                    </a>
                  </dd>
                </>
              )}
            </dl>
            {source.imageUrl && (
              <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-start">
                {/* Niente anteprima remota: la CSP vieta img-src https: arbitrario (e l'host terzo vedrebbe l'IP dell'utente). */}
                <div aria-hidden className="flex h-24 w-32 shrink-0 items-center justify-center rounded-xl bg-line/40 text-muted"><ImagePlus className="size-6" /></div>
                <label className="flex items-start gap-3">
                  <input type="checkbox" checked={keepSourceImage} onChange={(e) => setKeepSourceImage(e.target.checked)} className="mt-1 size-5 accent-[var(--basil)]" />
                  <span>
                    <span className="font-semibold">{t('sourceImageKeep')}</span>
                    <span className="block text-sm text-muted">{t('sourceImageLead')}</span>
                  </span>
                </label>
              </div>
            )}
          </section>
        )}

        {duplicatesShown.length > 0 && (
          <Alert tone="warn" title={t('duplicatesTitle')}>
            <p>{t('duplicatesLead')}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {duplicatesShown.map((d) => (
                <li key={d.id}>
                  <Link href={`/recipes/${d.id}`} target="_blank" className="inline-flex min-h-11 items-center font-semibold text-basil underline underline-offset-4">
                    {d.title}
                  </Link>{' '}
                  <span className="text-sm text-muted">({t(`duplicateReason.${d.reason}`)})</span>
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <section className="flex flex-col gap-5">
          <Field label={t('title')} htmlFor="title" flag={<FlagBadges flags={s.field_flags.title} />}>
            <Input id="title" required maxLength={RECIPE_LIMITS.title} value={s.title} onChange={(e) => set('title', e.target.value, 'title')} placeholder={t('titlePlaceholder')} className="font-display text-xl font-bold" />
          </Field>
          <Field label={t('description')} htmlFor="description">
            <Textarea id="description" maxLength={RECIPE_LIMITS.description} value={s.description} onChange={(e) => set('description', e.target.value)} rows={3} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={t('category')}
              htmlFor="category"
              hint={showSuggestedHint ? t('categorySuggested') : undefined}
            >
              <Select
                id="category"
                value={effectiveCategoryId}
                onChange={(e) => {
                  set('category_id', e.target.value);
                  setUserPickedCategory(true);
                  setAutoSuggested(false);
                }}
              >
                <option value="">{tCat('uncategorized')}</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('language')} htmlFor="language" hint={t('languageHint')}>
              <Select id="language" value={s.original_language} onChange={(e) => set('original_language', e.target.value)}>
                {[...new Set([s.original_language, ...RECIPE_LANGUAGES])].map((l) => (
                  <option key={l} value={l}>
                    {langNames?.of(l) ?? l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <details className="rounded-xl border border-line bg-surface px-4 py-2">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">{t('newCategory')}</summary>
            <div className="flex gap-2 pb-3">
              <label htmlFor="newcat" className="sr-only">
                {t('newCategoryName')}
              </label>
              <Input id="newcat" value={newCat} maxLength={40} onChange={(e) => setNewCat(e.target.value)} placeholder={t('newCategoryName')} />
              <Button onClick={addCategory}>{tc('add')}</Button>
            </div>
          </details>
          <Field label={t('tags')} htmlFor="tags" hint={t('tagsHint')}>
            <Input id="tags" value={s.tags} onChange={(e) => set('tags', e.target.value)} placeholder={t('tagsPlaceholder')} />
          </Field>
          <fieldset className="flex flex-col gap-1" aria-describedby="diet-hint">
            <legend className="mb-1 font-semibold">{t('dietHints')}</legend>
            <p id="diet-hint" className="text-sm text-muted">
              {t('dietHintsHint')}
            </p>
            <div className="flex flex-wrap gap-x-5">
              {DIETS.map((d) => {
                const on = (s.diet_hints ?? []).includes(d);
                return (
                  <label key={d} className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" checked={on} onChange={() => set('diet_hints', on ? (s.diet_hints ?? []).filter((x) => x !== d) : [...(s.diet_hints ?? []), d])} className="size-5 accent-[var(--basil)]" />
                    {ts(`diets.${d}`)}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </section>

        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('servings')} htmlFor="servings" flag={<FlagBadges flags={s.field_flags.servings} />}>
            <Input id="servings" inputMode="decimal" value={s.servings} onChange={(e) => set('servings', e.target.value.replace(/[^\d.,]/g, ''), 'servings')} placeholder={s.field_flags.servings?.includes('missing') ? t('notDetected') : ''} />
          </Field>
          {timeField('prep_minutes', t('prep'))}
          {timeField('cook_minutes', t('cook'))}
          {timeField('total_minutes', t('total'))}
        </section>

        <section aria-labelledby="ing-h" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="ing-h" className="text-2xl font-bold">
              {t('ingredients')}
            </h2>
            <FlagBadges flags={s.field_flags.ingredients} />
          </div>
          <p className="text-sm text-muted">{t('ingredientsHint')}</p>
          <ol className="flex flex-col gap-3">
            {s.ingredients.map((ing, idx) => (
              <li key={ing.key} className={cx('rounded-2xl border bg-surface p-3', ing.flags.some((f) => f !== 'ai_estimate') ? 'border-saffron-deep/60' : 'border-line')}>
                {ing.section && <p className="mb-2 text-sm font-semibold text-basil">{ing.section}</p>}
                <div className="grid grid-cols-[4.5rem_6.5rem_1fr] gap-2 sm:grid-cols-[5rem_8rem_1fr_1fr]">
                  <label className="sr-only" htmlFor={`q-${ing.key}`}>{t('quantity')}</label>
                  <input id={`q-${ing.key}`} className={inputClass} inputMode="decimal" value={ing.toTaste ? '' : ing.quantity} disabled={ing.toTaste} placeholder={ing.flags.includes('missing') ? '?' : t('quantityShort')} onChange={(e) => updIng(ing.key, { quantity: e.target.value })} />
                  <label className="sr-only" htmlFor={`u-${ing.key}`}>{t('unit')}</label>
                  <input id={`u-${ing.key}`} className={inputClass} list="unit-list" maxLength={RECIPE_LIMITS.ingredientUnit} value={ing.unit} placeholder={t('unit')} onChange={(e) => updIng(ing.key, { unit: e.target.value })} />
                  <label className="sr-only" htmlFor={`n-${ing.key}`}>{t('ingredientName')}</label>
                  <input id={`n-${ing.key}`} className={inputClass} maxLength={RECIPE_LIMITS.ingredientName} value={ing.name} placeholder={t('ingredientName')} onChange={(e) => updIng(ing.key, { name: e.target.value })} />
                  <label className="sr-only" htmlFor={`note-${ing.key}`}>{t('note')}</label>
                  <input id={`note-${ing.key}`} className={cx(inputClass, 'col-span-3 sm:col-span-1')} maxLength={RECIPE_LIMITS.ingredientNote} value={ing.note} placeholder={t('notePlaceholder')} onChange={(e) => updIng(ing.key, { note: e.target.value })} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" checked={ing.toTaste} onChange={(e) => updIng(ing.key, { toTaste: e.target.checked })} className="size-5 accent-[var(--basil)]" />
                    {t('toTaste')}
                  </label>
                  <FlagBadges flags={ing.flags} />
                  {ing.raw && ing.flags.length > 0 && <span className="text-sm text-muted">{t('originalText', { text: ing.raw })}</span>}
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" className="size-11 px-0" aria-label={tc('moveUp')} disabled={idx === 0} onClick={() => setS((p) => ({ ...p, ingredients: move(p.ingredients, idx, -1) }))}>
                      <ArrowUp aria-hidden className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="size-11 px-0" aria-label={tc('moveDown')} disabled={idx === s.ingredients.length - 1} onClick={() => setS((p) => ({ ...p, ingredients: move(p.ingredients, idx, 1) }))}>
                      <ArrowDown aria-hidden className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="size-11 px-0 text-tomato" aria-label={t('removeIngredient', { name: ing.name || String(idx + 1) })} onClick={() => setS((p) => ({ ...p, ingredients: p.ingredients.filter((i) => i.key !== ing.key) }))}>
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </span>
                </div>
              </li>
            ))}
          </ol>
          <datalist id="unit-list">
            {UNIT_KEYS.map((k) => (
              <option key={k} value={tu(k)} />
            ))}
          </datalist>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setS((p) => ({ ...p, ingredients: [...p.ingredients, emptyIngredient()] }))}>
              <Plus aria-hidden className="size-4" />
              {t('addIngredient')}
            </Button>
          </div>
          <details className="rounded-xl border border-line bg-surface px-4 py-2">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">{t('pasteIngredients')}</summary>
            <div className="flex flex-col gap-2 pb-3">
              <label htmlFor="bulk" className="text-sm text-muted">
                {t('pasteIngredientsHint')}
              </label>
              <Textarea id="bulk" rows={5} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'200 g farina\n2 uova\nsale q.b.'} />
              <div>
                <Button onClick={addBulk}>{t('parse')}</Button>
              </div>
            </div>
          </details>
        </section>

        <section aria-labelledby="steps-h" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="steps-h" className="text-2xl font-bold">
              {t('steps')}
            </h2>
            <FlagBadges flags={s.field_flags.steps} />
          </div>
          <ol className="flex flex-col gap-3">
            {s.steps.map((st: EditorStep, idx) => (
              <li key={st.key} className={cx('flex gap-3 rounded-2xl border bg-surface p-3', st.flags.some((f) => f !== 'ai_estimate') ? 'border-saffron-deep/60' : 'border-line')}>
                <span aria-hidden className="mt-2 flex size-8 shrink-0 items-center justify-center rounded-full bg-ink font-display font-bold text-porcelain">
                  {idx + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {st.section && <p className="text-sm font-semibold text-basil">{st.section}</p>}
                  <label htmlFor={`s-${st.key}`} className="sr-only">
                    {t('stepN', { n: idx + 1 })}
                  </label>
                  <Textarea id={`s-${st.key}`} rows={3} maxLength={RECIPE_LIMITS.stepText} value={st.text} onChange={(e) => updStep(st.key, e.target.value)} />
                  <div className="flex flex-wrap items-center gap-2">
                    <FlagBadges flags={st.flags} />
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" className="size-11 px-0" aria-label={tc('moveUp')} disabled={idx === 0} onClick={() => setS((p) => ({ ...p, steps: move(p.steps, idx, -1) }))}>
                        <ArrowUp aria-hidden className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="size-11 px-0" aria-label={tc('moveDown')} disabled={idx === s.steps.length - 1} onClick={() => setS((p) => ({ ...p, steps: move(p.steps, idx, 1) }))}>
                        <ArrowDown aria-hidden className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="size-11 px-0 text-tomato" aria-label={t('removeStep', { n: idx + 1 })} onClick={() => setS((p) => ({ ...p, steps: p.steps.filter((x) => x.key !== st.key) }))}>
                        <Trash2 aria-hidden className="size-4" />
                      </Button>
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div>
            <Button onClick={() => setS((p) => ({ ...p, steps: [...p.steps, emptyStep()] }))}>
              <Plus aria-hidden className="size-4" />
              {t('addStep')}
            </Button>
          </div>
        </section>

        {mode !== 'edit' && (
          <section className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold">{t('image')}</h2>
            <p className="text-sm text-muted">{t('imageHint')}</p>
            <div className="flex flex-wrap items-center gap-4">
              {imagePreview && <img src={imagePreview} alt="" className="h-28 w-40 rounded-xl object-cover" />}
              <label className={buttonClass('secondary')}>
                <ImagePlus aria-hidden className="size-5" />
                {imageFile ? t('changeImage') : t('chooseImage')}
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => onPickImage(e.target.files?.[0] ?? null)} />
              </label>
              {imageFile && (
                <Button variant="ghost" onClick={() => onPickImage(null)}>
                  {tc('remove')}
                </Button>
              )}
            </div>
          </section>
        )}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-2xl font-bold">{tv('label')}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['private', 'friends', 'public'] as Visibility[]).map((v) => (
              <label key={v} className={cx('flex cursor-pointer flex-col gap-1 rounded-2xl border-2 bg-surface p-4', s.visibility === v ? 'border-ink' : 'border-line')}>
                <span className="flex items-center gap-2 font-semibold">
                  <input type="radio" name="visibility" value={v} checked={s.visibility === v} onChange={() => set('visibility', v)} className="size-5 accent-[var(--ink)]" />
                  {tv(v)}
                </span>
                <span className="text-sm text-muted">{tv(`${v}Hint`)}</span>
              </label>
            ))}
          </div>
          {mode === 'review' && s.visibility === 'public' && <Alert tone="warn">{t('publicImportWarning')}</Alert>}
        </fieldset>

        <Field label={t('personalNote')} htmlFor="note" hint={t('personalNoteHint')}>
          <Textarea id="note" rows={3} maxLength={RECIPE_LIMITS.personalNote} value={s.personal_note} onChange={(e) => set('personal_note', e.target.value)} />
        </Field>

        {mode === 'review' && (
          <label className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4">
            <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="mt-1 size-5 accent-[var(--basil)]" />
            <span>
              <span className="font-semibold">{t('verifiedCheck')}</span>
              <span className="block text-sm text-muted">{t('verifiedHint')}</span>
            </span>
          </label>
        )}

        {error && <Alert tone="error">{error}</Alert>}

        <div className="sticky bottom-20 z-20 -mx-4 flex flex-wrap gap-3 border-t border-line bg-porcelain/95 px-4 py-3 backdrop-blur lg:bottom-0">
          <button type="submit" disabled={saving} className={buttonClass('primary', 'lg')}>
            {saving && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />}
            {saving ? tc('saving') : mode === 'review' ? t('saveImported') : tc('save')}
          </button>
          {onBack ? (
            <Button size="lg" variant="ghost" onClick={onBack}>
              {tc('back')}
            </Button>
          ) : (
            <Link href={recipeId ? `/recipes/${recipeId}` : '/recipes'} className={buttonClass('ghost', 'lg')}>
              {tc('cancel')}
            </Link>
          )}
        </div>
      </fieldset>
      {aside && <aside className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">{aside}</aside>}
    </form>
  );
}
