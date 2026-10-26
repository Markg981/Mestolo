'use client';

import { useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Minus, Plus, ShoppingBasket } from 'lucide-react';
import { formatQuantity } from '@/lib/recipes/ingredient-parser';
import { scaleIngredients } from '@/lib/recipes/scale';
import { convertIngredients, formatFractionQuantity, UNIT_SYSTEMS, type UnitSystem } from '@/lib/recipes/convert';
import { UNIT_KEYS } from '@/lib/recipes/units';
import type { Ingredient } from '@/lib/recipes/types';
import { addRecipeToShopping } from '@/app/actions/planning';
import { LiveMessage } from '../client-ui';
import { ShoppingTargetSelect } from '../shopping-target';
import type { ListOption } from '@/lib/shopping/targets';
import { Badge, Button } from '../ui';

const UNIT_SYSTEM_KEY = 'mestolo:unit-system';
const listeners = new Set<() => void>();
let memorySystem: UnitSystem | null = null;

function readSystem(): UnitSystem {
  if (memorySystem) return memorySystem;
  try {
    const saved = localStorage.getItem(UNIT_SYSTEM_KEY);
    if (saved === 'metric' || saved === 'us') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'original';
}

function writeSystem(s: UnitSystem) {
  memorySystem = s;
  try {
    localStorage.setItem(UNIT_SYSTEM_KEY, s);
  } catch {
    /* storage unavailable: the choice lasts for this page view only */
  }
  listeners.forEach((l) => l());
}

function subscribeSystem(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

/** Ingredient list with a servings stepper, opt-in display-only unit conversion (never saved) and "add to shopping list". */
export function IngredientList({ recipeId, ingredients, baseServings, showFlags, lists = [] }: { lists?: ListOption[]; recipeId: string; ingredients: Ingredient[]; baseServings: number | null; showFlags: boolean }) {
  const t = useTranslations('recipe');
  const tu = useTranslations('units');
  const tf = useTranslations('flags');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [servings, setServings] = useState<number | null>(baseServings);
  const [targetList, setTargetList] = useState(lists[0]?.id ?? '');
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [pending, start] = useTransition();

  const scaled = useMemo(() => (servings && baseServings ? scaleIngredients(ingredients, baseServings, servings) : ingredients), [ingredients, baseServings, servings]);
  const changed = !!(servings && baseServings && servings !== baseServings);

  const system = useSyncExternalStore(subscribeSystem, readSystem, () => 'original' as UnitSystem);
  const pickSystem = writeSystem;
  const shown = useMemo(() => convertIngredients(scaled, system), [scaled, system]);

  const unit = (u: string | null) => (!u ? '' : UNIT_KEYS.includes(u) ? tu(u) : u);
  const qty = (i: Ingredient, fractions: boolean) => {
    if (i.toTaste) return t('toTaste');
    if (i.quantity === null) return unit(i.unit);
    const n = fractions ? formatFractionQuantity(i.quantity) : formatQuantity(i.quantity, locale, i.quantityMax);
    const max = fractions && i.quantityMax ? `–${formatFractionQuantity(i.quantityMax)}` : '';
    return `${n}${max} ${unit(i.unit)}`.trim();
  };

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
            <button type="button" className="inline-flex min-h-11 items-center text-sm text-basil underline underline-offset-4" onClick={() => setServings(baseServings)}>
              {t('resetServings', { n: baseServings })}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">{t('servingsUnknown')}</p>
      )}
      {changed && <p className="text-sm text-muted">{t('scaledNote')}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold" id="unit-system-label">
          {t('unitSystemLabel')}
        </span>
        <div role="radiogroup" aria-labelledby="unit-system-label" className="inline-flex rounded-full border border-line bg-surface p-0.5">
          {UNIT_SYSTEMS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={system === s}
              className={`min-h-11 rounded-full px-3 text-sm ${system === s ? 'bg-basil font-semibold text-white' : ''}`}
              onClick={() => pickSystem(s)}
            >
              {t(s === 'original' ? 'unitSystemOriginal' : s === 'metric' ? 'unitSystemMetric' : 'unitSystemUs')}
            </button>
          ))}
        </div>
      </div>
      {system !== 'original' && <p className="text-sm text-muted">{t('convertedNote')}</p>}

      <ul className="flex flex-col divide-y divide-line">
        {shown.map(({ ingredient: ing, converted }, i) => {
          const header = ing.section && (i === 0 || shown[i - 1].ingredient.section !== ing.section) ? ing.section : null;
          return (
            <li key={i} className="py-2.5">
              {header && <p className="mb-1 pt-2 text-sm font-semibold text-basil">{header}</p>}
              <div className="grid grid-cols-[6.5rem_1fr] gap-3">
                <span className="tabular text-right font-semibold">
                  {converted ? (
                    <span tabIndex={0} title={t('convertedTitle', { original: qty(scaled[i], false) })} aria-label={`${qty(ing, system === 'us')}, ${t('convertedBadge')}, ${t('convertedTitle', { original: qty(scaled[i], false) })}`} className="underline decoration-dotted underline-offset-4">
                      {qty(ing, system === 'us')}
                      <span className="block text-xs font-normal text-muted">
                        {t('convertedBadge')} · {t('convertedTitle', { original: qty(scaled[i], false) })}
                      </span>
                    </span>
                  ) : (
                    qty(ing, false)
                  )}
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
        <ShoppingTargetSelect lists={lists} value={targetList} onChange={setTargetList} />
        <Button
          disabled={pending || !ingredients.length}
          onClick={() =>
            start(async () => {
              const res = await addRecipeToShopping(recipeId, servings, undefined, targetList || undefined);
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
