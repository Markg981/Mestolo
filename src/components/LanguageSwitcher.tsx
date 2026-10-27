'use client';

import { useActionTransition } from '@/lib/run-action';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { LOCALES, LOCALE_NAMES } from '@/i18n/config';
import { setLocale } from '@/app/actions/settings';
import { Select } from './ui';

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, start] = useActionTransition();
  return (
    <label className={`flex items-center gap-2 ${className ?? ''}`}>
      <span className="sr-only">{t('language')}</span>
      <Select
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          start(async () => {
            await setLocale(v);
            router.refresh();
          });
        }}
        className="min-h-11 w-auto py-1 text-sm"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </Select>
    </label>
  );
}
