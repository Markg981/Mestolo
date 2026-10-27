'use client';

import { useActionTransition } from '@/lib/run-action';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { deleteNutrition, estimateNutrition, saveNutrition } from '@/app/actions/nutrition';
import { NUTRIENT_KEYS, emptyNutrition, validateNutrition, type NutrientKey, type NutritionSource, type NutritionValues } from '@/lib/nutrition';
import { Alert, Badge, Button, Field, Input } from '../ui';
import { NUTRIENT_LABEL } from './NutritionBox';

type Ai = { available: boolean; providerName: string | null; remainingToday: number | null };

/** Owner editor: any manual change turns the source into "manual"; an untouched AI estimate stays labelled as an estimate. */
export function NutritionEditor({ recipeId, initial, initialSource, ai }: { recipeId: string; initial: NutritionValues | null; initialSource: NutritionSource | null; ai: Ai }) {
  const t = useTranslations('nutrition');
  const te = useTranslations('errors');
  const router = useRouter();
  const [text, setText] = useState<Record<NutrientKey, string>>(() => {
    const v = initial ?? emptyNutrition();
    return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, v[k] === null ? '' : String(v[k])])) as Record<NutrientKey, string>;
  });
  const [source, setSource] = useState<NutritionSource | null>(initialSource);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useActionTransition();

  const toValues = () => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, text[k].trim() === '' ? null : Number(text[k].replace(',', '.'))])) as Record<NutrientKey, number | null>;

  const change = (k: NutrientKey, v: string) => {
    setText((p) => ({ ...p, [k]: v }));
    setSource('manual');
    setMessage(null);
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const raw = toValues();
    const v = validateNutrition(raw);
    if (!v.ok) {
      setError(v.field === 'empty' ? t('invalidEmpty') : v.field === 'sugars_g' ? t('invalidSugars') : v.field === 'saturated_fat_g' ? t('invalidSaturated') : t('invalidValue'));
      return;
    }
    start(async () => {
      const res = await saveNutrition(recipeId, raw, source === 'ai_estimate' ? 'ai_estimate' : 'manual');
      if (!res.ok) return setError(te(res.error));
      setMessage(t('saved'));
      router.refresh();
    });
  };

  const estimate = () => {
    setError(null);
    setMessage(null);
    start(async () => {
      const res = await estimateNutrition(recipeId);
      if (!res.ok) return setError(te(res.error));
      setText(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, res.data.values[k] === null ? '' : String(res.data.values[k])])) as Record<NutrientKey, string>);
      setSource('ai_estimate');
      setMessage(t('estimateReady'));
    });
  };

  const remove = () => {
    if (!window.confirm(t('removeConfirm'))) return;
    start(async () => {
      const res = await deleteNutrition(recipeId);
      if (!res.ok) return setError(te(res.error));
      setText(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, ''])) as Record<NutrientKey, string>);
      setSource(null);
      setMessage(t('removed'));
      router.refresh();
    });
  };

  return (
    <form onSubmit={save} className="flex max-w-xl flex-col gap-5">
      {source && (
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-muted">{t('currentSource')}</span>
          <Badge tone={source === 'ai_estimate' ? 'saffron' : source === 'imported' ? 'neutral' : 'basil'}>{t(`source.${source}`)}</Badge>
        </p>
      )}
      {source === 'ai_estimate' && <Alert tone="warn">{t('note.ai_estimate')}</Alert>}
      <p className="text-sm text-muted">{t('perServingHint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {NUTRIENT_KEYS.map((k) => (
          <Field key={k} label={`${t(`field.${NUTRIENT_LABEL[k]}`)} (${k === 'energy_kcal' ? t('kcal') : t('gram')})`} htmlFor={`n-${k}`}>
            <Input id={`n-${k}`} inputMode="decimal" value={text[k]} onChange={(e) => change(k, e.target.value)} />
          </Field>
        ))}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {t('save')}
        </Button>
        {ai.available ? (
          <Button type="button" onClick={estimate} disabled={pending}>
            {t('estimate')}
          </Button>
        ) : (
          <p className="text-sm text-muted">{t('aiUnavailable')}</p>
        )}
        {initialSource && (
          <Button type="button" variant="ghost" onClick={remove} disabled={pending}>
            {t('remove')}
          </Button>
        )}
      </div>
      {ai.available && <p className="text-sm text-muted">{t('estimateHint')}</p>}
    </form>
  );
}
