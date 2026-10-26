'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { NUTRIENT_KEYS, scaleNutrition, type NutrientKey, type NutritionSource, type NutritionValues } from '@/lib/nutrition';
import { Badge } from '../ui';

export const NUTRIENT_LABEL: Record<NutrientKey, string> = {
  energy_kcal: 'energy',
  protein_g: 'protein',
  carbs_g: 'carbs',
  sugars_g: 'sugars',
  fat_g: 'fat',
  saturated_fat_g: 'saturated',
  fiber_g: 'fiber',
  salt_g: 'salt',
};
export const SUB_NUTRIENTS: NutrientKey[] = ['sugars_g', 'saturated_fat_g'];

/** Nutrition panel: values are per serving, scaled to the number of portions chosen by the viewer. */
export function NutritionBox({ values, source, updatedAt, baseServings, editHref }: { values: NutritionValues; source: NutritionSource; updatedAt: string; baseServings: number | null; editHref?: string }) {
  const t = useTranslations('nutrition');
  const locale = useLocale();
  const [portions, setPortions] = useState(1);
  const shown = scaleNutrition(values, portions);
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(updatedAt));
  const step = (d: number) => setPortions((p) => Math.min(100, Math.max(1, p + d)));

  return (
    <section aria-labelledby="nutrition-title" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-sunk p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="nutrition-title" className="text-xl font-bold">
          {t('title')}
        </h2>
        <Badge tone={source === 'ai_estimate' ? 'saffron' : source === 'imported' ? 'neutral' : 'basil'}>{t(`source.${source}`)}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{portions === 1 ? t('perServing') : t('forPortions', { count: portions })}</span>
        <span role="group" aria-label={t('portions')} className="inline-flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} disabled={portions <= 1} aria-label={t('fewer')} className="inline-flex size-11 items-center justify-center rounded-full border border-line disabled:opacity-40">
            −
          </button>
          <output className="min-w-6 text-center font-semibold" aria-live="polite">
            {portions}
          </output>
          <button type="button" onClick={() => step(1)} disabled={portions >= 100} aria-label={t('more')} className="inline-flex size-11 items-center justify-center rounded-full border border-line disabled:opacity-40">
            +
          </button>
        </span>
        {baseServings !== null && <span className="text-muted">{t('recipeServings', { count: baseServings })}</span>}
      </div>

      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
        {NUTRIENT_KEYS.filter((k) => shown[k] !== null).map((k) => (
          <div key={k} className="contents">
            <dt className={SUB_NUTRIENTS.includes(k) ? 'pl-4 text-muted' : 'font-semibold'}>{t(`field.${NUTRIENT_LABEL[k]}`)}</dt>
            <dd className="text-right tabular-nums">
              {fmt.format(shown[k]!)} {k === 'energy_kcal' ? t('kcal') : t('gram')}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-sm text-muted">
        {t(`note.${source}`)} {t('updatedOn', { date })}
      </p>
      {editHref && (
        <Link href={editHref} className="self-start font-semibold text-basil underline underline-offset-4">
          {t('edit')}
        </Link>
      )}
    </section>
  );
}
