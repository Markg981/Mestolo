'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw, Settings2, Sparkles, X } from 'lucide-react';
import { applyPlan, previewPlan, savePlanPreferences } from '@/app/actions/planning';
import { LiveMessage, Modal } from '@/components/client-ui';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import type { PlanPrefs, Proposal } from '@/lib/plan/generator';
import type { MealSlot } from '@/lib/plan/week';

const ALL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const csv = (s: string) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];

function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-3 text-sm">
      <input id={id} type="checkbox" className="size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function PlanGenerator({
  weekStart,
  days,
  dayNames,
  prefs,
  categories,
  hasEntries,
}: {
  weekStart: string;
  days: { iso: string; label: string }[];
  /** nomi dei giorni, indice 0 = lunedi' */
  dayNames: string[];
  prefs: PlanPrefs;
  categories: { id: string; label: string }[];
  hasEntries: boolean;
}) {
  const t = useTranslations('plan');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [open, setOpen] = useState(false);
  const [p, setP] = useState(prefs);
  const [tags, setTags] = useState({ pref: prefs.preferredTags.join(', '), excl: prefs.excludedTags.join(', '), avoid: prefs.avoidIngredients.join(', ') });
  const [maxMin, setMaxMin] = useState(prefs.weekdayMaxMinutes?.toString() ?? '');
  const [serv, setServ] = useState(prefs.servings?.toString() ?? '');
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<Proposal[] | null>(null);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [empty, setEmpty] = useState(false);

  const dayLabel = (iso: string) => days.find((d) => d.iso === iso)?.label ?? iso;
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  const multi = (e: React.ChangeEvent<HTMLSelectElement>) => Array.from(e.target.selectedOptions).map((o) => o.value);

  const current = (): PlanPrefs => ({
    ...p,
    preferredTags: csv(tags.pref),
    excludedTags: csv(tags.excl),
    avoidIngredients: csv(tags.avoid),
    weekdayMaxMinutes: maxMin ? Number(maxMin) : null,
    servings: serv ? Number(serv) : null,
  });

  const savePrefs = () =>
    start(async () => {
      const res = await savePlanPreferences(current());
      if (res.ok) {
        setOpen(false);
        setMsg({ text: t('prefsSaved'), tone: 'success' });
        router.refresh();
      } else setMsg({ text: te(res.error), tone: 'error' });
    });

  const generate = (nextSeed: number, replaceFilled = replace) =>
    start(async () => {
      const res = await previewPlan({ weekStart, seed: nextSeed, replaceFilled });
      if (!res.ok) return setMsg({ text: te(res.error), tone: 'error' });
      setSeed(nextSeed);
      setEmpty(res.data.proposals.length === 0);
      setPreview(res.data.proposals);
    });

  const regenerateOne = (x: Proposal) =>
    start(async () => {
      if (!preview) return;
      const next = seed + 1 + Math.floor(Math.random() * 1000);
      const res = await previewPlan({
        weekStart,
        seed: next,
        replaceFilled: replace,
        cell: { date: x.date, slot: x.slot },
        keep: preview.filter((o) => o !== x).map((o) => ({ date: o.date, slot: o.slot, recipeId: o.recipeId })),
        excludeRecipeIds: [x.recipeId],
      });
      if (!res.ok) return setMsg({ text: te(res.error), tone: 'error' });
      const [repl] = res.data.proposals;
      if (repl) setPreview(preview.map((o) => (o === x ? repl : o)));
    });

  const save = () =>
    start(async () => {
      if (!preview?.length) return;
      const res = await applyPlan({ weekStart, replaceFilled: replace, proposals: preview.map((x) => ({ date: x.date, slot: x.slot, recipeId: x.recipeId, servings: x.servings })) });
      if (!res.ok) return setMsg({ text: te(res.error), tone: 'error' });
      setMsg({ text: res.data.skipped ? t('savedSkipped', { saved: res.data.saved, skipped: res.data.skipped }) : t('savedPlan', { saved: res.data.saved }), tone: 'success' });
      setPreview(null);
      router.refresh();
    });

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={pending} onClick={() => generate(Math.floor(Math.random() * 1_000_000))}>
          <Sparkles aria-hidden className="size-5" />
          {t('generate')}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Settings2 aria-hidden className="size-5" />
          {t('prefsButton')}
        </Button>
        {hasEntries && (
          <Check
            id="replace-filled"
            label={t('replaceFilled')}
            checked={replace}
            onChange={(v) => {
              setReplace(v);
              setPreview(null);
            }}
          />
        )}
        <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
      </div>

      {preview && (
        <section aria-labelledby="plan-preview" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-dashed border-ink bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="plan-preview" className="font-display text-lg font-bold">
              {t('previewTitle')}
            </h2>
            <p className="text-sm text-muted">{t('previewNote')}</p>
          </div>
          {empty || preview.length === 0 ? (
            <Alert tone="info">{t('previewEmpty')}</Alert>
          ) : (
            <ul className="flex flex-col gap-1">
              {preview.map((x) => (
                <li key={`${x.date}${x.slot}`} className="flex items-center gap-2 rounded-lg bg-saffron-wash px-2 py-1">
                  <span className="w-40 shrink-0 text-xs font-semibold text-muted">
                    {dayLabel(x.date)} · {t(`slots.${x.slot}`)}
                  </span>
                  <span className="min-w-0 flex-1 line-clamp-2 text-sm font-semibold">{x.title}</span>
                  {x.servings && <span className="text-xs text-muted">×{Number(x.servings)}</span>}
                  <button type="button" disabled={pending} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-saffron/40" aria-label={t('regenerateSlot', { slot: t(`slots.${x.slot}`), day: dayLabel(x.date) })} onClick={() => regenerateOne(x)}>
                    <RefreshCw aria-hidden className="size-4" />
                  </button>
                  <button type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-saffron/40" aria-label={t('discardSlot', { title: x.title })} onClick={() => setPreview(preview.filter((o) => o !== x))}>
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={pending || !preview.length} onClick={save}>
              {t('savePlan')}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => generate(seed + 1)}>
              <RefreshCw aria-hidden className="size-5" />
              {t('regenerateAll')}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setPreview(null)}>
              {t('discard')}
            </Button>
          </div>
        </section>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('prefsTitle')} closeLabel={tc('close')}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{t('mealsToCover')}</legend>
          <div className="flex flex-wrap gap-2">
            {ALL_SLOTS.map((s) => (
              <Check key={s} id={`pm-${s}`} label={t(`slots.${s}`)} checked={p.meals.includes(s)} onChange={(v) => setP({ ...p, meals: toggle(p.meals, s, v) })} />
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{t('daysToCover')}</legend>
          <div className="flex flex-wrap gap-2">
            {dayNames.map((n, i) => (
              <Check key={i} id={`pd-${i}`} label={n} checked={p.days.includes(i)} onChange={(v) => setP({ ...p, days: toggle(p.days, i, v) })} />
            ))}
          </div>
        </fieldset>
        <Field label={t('weekdayMax')} hint={t('weekdayMaxHint')} htmlFor="pw-max">
          <Input id="pw-max" inputMode="numeric" value={maxMin} onChange={(e) => setMaxMin(e.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Field label={t('preferredTags')} hint={t('tagsHint')} htmlFor="pw-ptags">
          <Input id="pw-ptags" value={tags.pref} onChange={(e) => setTags({ ...tags, pref: e.target.value })} />
        </Field>
        <Field label={t('excludedTags')} hint={t('tagsHint')} htmlFor="pw-etags">
          <Input id="pw-etags" value={tags.excl} onChange={(e) => setTags({ ...tags, excl: e.target.value })} />
        </Field>
        {categories.length > 0 && (
          <>
            <Field label={t('preferredCategories')} hint={t('multiHint')} htmlFor="pw-pcat">
              <Select id="pw-pcat" multiple size={Math.min(5, categories.length)} className="h-auto" value={p.preferredCategoryIds} onChange={(e) => setP({ ...p, preferredCategoryIds: multi(e) })}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('excludedCategories')} hint={t('multiHint')} htmlFor="pw-ecat">
              <Select id="pw-ecat" multiple size={Math.min(5, categories.length)} className="h-auto" value={p.excludedCategoryIds} onChange={(e) => setP({ ...p, excludedCategoryIds: multi(e) })}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field label={t('avoidIngredients')} hint={t('tagsHint')} htmlFor="pw-avoid">
          <Input id="pw-avoid" value={tags.avoid} onChange={(e) => setTags({ ...tags, avoid: e.target.value })} />
        </Field>
        <Field label={t('repeatLevel')} htmlFor="pw-repeat">
          <Select id="pw-repeat" value={p.repeatLevel} onChange={(e) => setP({ ...p, repeatLevel: e.target.value as PlanPrefs['repeatLevel'] })}>
            <option value="low">{t('repeatLow')}</option>
            <option value="medium">{t('repeatMedium')}</option>
            <option value="high">{t('repeatHigh')}</option>
          </Select>
        </Field>
        <Field label={t('prefServings')} htmlFor="pw-serv">
          <Input id="pw-serv" inputMode="numeric" value={serv} onChange={(e) => setServ(e.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Button variant="primary" disabled={pending || !p.meals.length || !p.days.length} onClick={savePrefs}>
          {t('prefsSave')}
        </Button>
      </Modal>
    </div>
  );
}
