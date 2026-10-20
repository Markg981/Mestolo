'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { getReminderPlan } from '@/app/actions/notifications';
import { planReminders } from '@/lib/notifications/schedule';
import { canScheduleNative, replaceNativeReminders } from '@/lib/native/notifications';

/** Fired by the settings form after saving, so the native app reschedules right away. */
export const REMINDERS_CHANGED_EVENT = 'mestolo:reminders-changed';

/**
 * Native app only: keeps the OS-scheduled local notifications of the next 7 days in line with the meal plan.
 * Runs when the app opens, when it comes back to the foreground and whenever `version` changes
 * (the plan page passes a signature of its entries). Renders nothing; does nothing on the web.
 */
export function MealReminderSync({ version = '' }: { version?: string }) {
  const t = useTranslations('notifications');
  useEffect(() => {
    if (!canScheduleNative()) return;
    let running = false;
    const sync = async () => {
      if (running) return;
      running = true;
      try {
        const res = await getReminderPlan();
        if (!res.ok) return;
        const reminders = planReminders(res.data.entries, res.data.prefs, new Date());
        await replaceNativeReminders(reminders, (r) => ({ title: t('title'), body: t(`body.${r.slot}`, { title: r.title }) }));
      } catch {
        /* notifications are best effort */
      } finally {
        running = false;
      }
    };
    sync();
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(REMINDERS_CHANGED_EVENT, sync);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(REMINDERS_CHANGED_EVENT, sync);
    };
  }, [version, t]);
  return null;
}
