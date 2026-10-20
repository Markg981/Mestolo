'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import { rateRecipe } from '@/app/actions/ratings';
import { LiveMessage } from '../client-ui';
import { StarsDisplay } from './StarsDisplay';
import { MIN_RATINGS_TO_SHOW } from '@/lib/recipes/rating';

interface Props {
  recipeId: string;
  isOwner: boolean;
  avg: number | string | null;
  count: number;
  mine: number | null;
}

/** Sezione valutazioni della scheda ricetta: media (da MIN_RATINGS_TO_SHOW voti) e input a stelle per chi non e' l'autore. */
export function RecipeRating({ recipeId, isOwner, avg, count, mine }: Props) {
  const t = useTranslations('ratings');
  const te = useTranslations('errors');
  const [value, setValue] = useState<number | null>(mine);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // aggiornamento ottimistico dell'aggregato: toglie il voto salvato e aggiunge quello corrente
  let n = count;
  let sum = Number(avg ?? 0) * count;
  if (mine !== null) {
    n -= 1;
    sum -= mine;
  }
  if (value !== null) {
    n += 1;
    sum += value;
  }
  const shownAvg = n >= MIN_RATINGS_TO_SHOW ? sum / n : null;

  function choose(stars: number | null) {
    const before = value;
    setValue(stars);
    setError(null);
    start(async () => {
      const r = await rateRecipe(recipeId, stars);
      if (!r.ok) {
        setValue(before);
        setError(te(r.error));
      }
    });
  }

  // radiogroup con tabindex "roving": frecce per spostarsi e votare, Canc/Backspace per rimuovere
  function onKey(e: React.KeyboardEvent, i: number) {
    let next = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(4, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 4;
    else if ((e.key === 'Delete' || e.key === 'Backspace') && value !== null) {
      e.preventDefault();
      choose(null);
      return;
    } else return;
    e.preventDefault();
    refs.current[next]?.focus();
    choose(next + 1);
  }

  if (isOwner && shownAvg === null) return null;
  return (
    <section aria-labelledby="ratings-h" className="flex flex-col gap-2">
      <h2 id="ratings-h" className="text-lg font-bold">
        {t('title')}
      </h2>
      {shownAvg !== null ? <StarsDisplay avg={shownAvg} count={n} /> : <p className="text-sm text-muted">{t('notEnough')}</p>}
      {!isOwner && (
        <div className="flex flex-col gap-1">
          <span id="ratings-yours" className="text-sm font-semibold">
            {t('yours')}
          </span>
          <div role="radiogroup" aria-labelledby="ratings-yours" className="flex gap-1">
            {[1, 2, 3, 4, 5].map((s, i) => (
              <button
                key={s}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={value === s}
                aria-label={t('star', { n: s })}
                tabIndex={value === s || (value === null && i === 0) ? 0 : -1}
                onClick={() => choose(value === s ? null : s)}
                onKeyDown={(e) => onKey(e, i)}
                className="flex size-11 items-center justify-center rounded-full hover:bg-sunk focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <Star aria-hidden className={`size-7 ${value !== null && s <= value ? 'fill-saffron text-saffron' : 'text-muted'}`} />
              </button>
            ))}
          </div>
          <span className="text-sm text-muted">{value === null ? t('hint') : t('saved')}</span>
        </div>
      )}
      <LiveMessage message={error} tone="error" />
    </section>
  );
}
