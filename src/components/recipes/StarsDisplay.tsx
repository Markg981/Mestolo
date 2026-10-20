import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Media delle stelle in sola lettura, con testo accessibile completo. */
export function StarsDisplay({ avg, count }: { avg: number | string; count: number }) {
  const t = useTranslations('ratings');
  const value = Number(avg).toFixed(1);
  return (
    <span className="inline-flex items-center gap-1">
      <Star aria-hidden className="size-4 fill-saffron text-saffron" />
      <span aria-hidden>
        {value} ({count})
      </span>
      <span className="sr-only">{t('summary', { avg: value, count })}</span>
    </span>
  );
}
