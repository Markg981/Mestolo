import { createTranslator } from 'next-intl';
import { isLocale, DEFAULT_LOCALE } from '@/i18n/config';
import type { MealSlot } from '@/lib/plan/week';

/** Notification text for a planned meal, in the user's locale (used by the Web Push cron route). */
export async function mealReminderText(locale: string, slot: MealSlot, title: string): Promise<{ title: string; body: string }> {
  const loc = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const messages = (await import(`../../../messages/${loc}.json`)).default;
  const t = createTranslator({ locale: loc, messages, namespace: 'notifications' });
  return { title: t('title'), body: t(`body.${slot}`, { title }) };
}
