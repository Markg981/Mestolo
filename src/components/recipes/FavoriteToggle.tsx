'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Heart } from 'lucide-react';
import { toggleFavorite } from '@/app/actions/recipes';
import { useActionTransition } from '@/lib/run-action';
import { cx } from '../ui';

/** Heart over a recipe card: saves or removes the recipe from favourites without opening it. */
export function FavoriteToggle({ recipeId, title, initial }: { recipeId: string; title: string; initial: boolean }) {
  const t = useTranslations('card');
  const [fav, setFav] = useState(initial);
  const [pending, start] = useActionTransition();

  const toggle = () => {
    const next = !fav;
    // optimistic: the heart changes at once and goes back if the server refuses
    setFav(next);
    start(async () => {
      const res = await toggleFavorite(recipeId, next).catch((e) => {
        setFav(!next);
        throw e;
      });
      if (!res.ok) setFav(!next);
    });
  };

  return (
    <button
      type="button"
      aria-pressed={fav}
      aria-label={t('favoriteToggle', { title })}
      disabled={pending}
      onClick={toggle}
      className={cx(
        'no-print absolute right-2 top-2 z-10 flex size-11 items-center justify-center rounded-full bg-surface/90 shadow-[var(--shadow-card)] backdrop-blur hover:bg-surface motion-safe:transition-transform motion-safe:active:scale-90',
        fav ? 'text-terracotta-deep' : 'text-muted hover:text-ink',
      )}
    >
      <Heart aria-hidden className="size-5" fill={fav ? 'currentColor' : 'none'} />
    </button>
  );
}
