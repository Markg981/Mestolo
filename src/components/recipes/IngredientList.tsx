'use client';

import { useMemo, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Minus, Plus, ShoppingBasket } from 'lucide-react';
import { formatQuantity } from '@/lib/recipes/ingredient-parser';
import { scaleIngredients } from '@/lib/recipes/scale';
import { UNIT_KEYS } from '@/lib/recipes/units';
import type { Ingredient } from '@/lib/recipes/types';
import { addRecipeToShopping } from '@/app/actions/planning';
import { LiveMessage } from '../client-ui';
import { Badge, Button } from '../ui';

/** Ingredient list with a servings stepper (linear scaling, units never converted) and "add to shopping list". */
export function IngredientList({ recipeId, ingredients, baseServings, showFlags }: { recipeId: string; ingredients: Ingredient[]; baseServings: number | null; showFlags: boolean }) {
  const t = useTranslations('recipe');
  const tu = useTranslations('units');
  const tf = useTranslations('flags');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [servings, setServings] = useState<number | null>(baseServings);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [pending, start] = useTransition();

  const scaled = useMemo(() => (servings && baseServings ? scaleIngredients(ingredients, baseServings, servings) : ingredients), [ingredients, baseServings, servings]);
  const changed = !!(servings && baseServings && servings !== baseServings);

  const unit = (u: string | null) => (!u ? '' : UNIT_KEYS.includes(u) ? tu(u) : u);

  return (
    <div className="flex flex-col gap-4">
      {baseServings ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold" id="servings-label">
            {t('servingsLabel')}
          </span>
          <div role="group" aria-labelledby="servings-label" className="inline-flex items-center rounded-full border border-line bg-surface">
            <Button variant="ghost" className="size-11 px-0" aria-label={t('lessServings')} disabled={!servings || servings <= 1} onClick={() => setServings((s) => Math.max(1, (s ?? 1) - 1))}>
              <Minus aria-hidden className="size-4" />
            </Button>
            <output aria-live="polite" className="tabular min-w-10 text-center text-lg font-bold">
              {servings}
            </output>
            <Button variant="ghost" className="size-11 px-0" aria-label={t('moreServings')} onClick={() => setServings((s) => Math.min(1000, (s ?? 0) + 1))}>
              <Plus aria-hidden className="size-4" />
            </Button>
          </div>
          {changed && (
            <button type="button" className="text-sm text-basil underline underline-offset-4" onClick={() => setServings(baseServings)}>
              {t('resetServings', { n: baseServings })}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">{t('servingsUnknown')}</p>
      )}
      {changed && <p className="text-sm text-muted">{t('scaledNote')}</p>}

      <ul className="flex flex-col divide-y divide-line">
        {scaled.map((ing, i) => {
          const header = ing.section && (i === 0 || scaled[i - 1].section !== ing.section) ? ing.section : null;
          return (
            <li key={i} className="py-2.5">
              {header && <p className="mb-1 pt-2 text-sm font-semibold text-basil">{header}</p>}
              <div className="grid grid-cols-[6.5rem_1fr] gap-3">
                <span className="tabular text-right font-semibold">
                  {ing.toTaste ? t('toTaste') : ing.quantity !== null ? `${formatQuantity(ing.quantity, locale, ing.quantityMax)} ${unit(ing.unit)}`.trim() : unit(ing.unit)}
                </span>
                <span>
                  {ing.name}
                  {ing.note && <span className="text-muted">, {ing.note}</span>}
                  {showFlags &&
                    ing.flags?.map((f) => (
                      <Badge key={f} tone="saffron" className="ml-2">
                        {tf(f)}
                      </Badge>
                    ))}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-1">
        <Button
          disabled={pending || !ingredients.length}
          onClick={() =>
            start(async () => {
              const res = await addRecipeToShopping(recipeId, servings);
              setMsg(res.ok ? { text: t('addedToShopping', { added: res.data.added, merged: res.data.merged }), tone: 'success' } : { text: te(res.error), tone: 'error' });
            })
          }
        >
          <ShoppingBasket aria-hidden className="size-5" />
          {changed ? t('addToShoppingFor', { n: servings ?? 0 }) : t('addToShopping')}
        </Button>
        <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
      </div>
    </div>
  );
}
