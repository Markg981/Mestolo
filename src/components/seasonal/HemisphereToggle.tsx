'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { HEMISPHERE_COOKIE, type Hemisphere } from '@/lib/seasonal';

/** Saves the choice in a first-party cookie (no DB) and refreshes the server-rendered section. */
function saveHemisphere(h: Hemisphere) {
  document.cookie = `${HEMISPHERE_COOKIE}=${h}; path=/; max-age=31536000; samesite=lax`;
}

export function HemisphereToggle({ value }: { value: Hemisphere }) {
  const t = useTranslations('seasonal');
  const router = useRouter();
  const set = (h: Hemisphere) => {
    saveHemisphere(h);
    router.refresh();
  };
  return (
    <div role="group" aria-label={t('hemisphere')} className="flex items-center gap-1 text-sm">
      {(['north', 'south'] as const).map((h) => (
        <button
          key={h}
          type="button"
          aria-pressed={value === h}
          onClick={() => set(h)}
          className={`min-h-11 rounded-full border px-3 py-1 font-semibold ${value === h ? 'border-transparent bg-basil text-white' : 'border-line bg-surface hover:bg-sunk'}`}
        >
          {t(h)}
        </button>
      ))}
    </div>
  );
}
