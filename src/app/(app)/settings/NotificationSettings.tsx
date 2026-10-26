'use client';

import { useState, useSyncExternalStore, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { removePushSubscription, savePushSubscription, saveNotificationPreferences } from '@/app/actions/notifications';
import { LiveMessage } from '@/components/client-ui';
import { Alert, Card, Field, Input, buttonClass } from '@/components/ui';
import { MEAL_SLOTS } from '@/lib/plan/week';
import { isValidTimeZone, type ReminderPrefs } from '@/lib/notifications/schedule';
import { canScheduleNative, requestNativePermission } from '@/lib/native/notifications';
import { browserTimeZone, isIosBrowserTab, subscribeToPush, unsubscribeFromPush, webPushSupported } from '@/lib/notifications/web-push-client';
import { REMINDERS_CHANGED_EVENT } from '@/components/pwa/MealReminderSync';

type Env = 'checking' | 'native' | 'web' | 'unsupported';
const noopSubscribe = () => () => undefined;

export function NotificationSettings({ initial, vapidPublicKey, frequentSchedule = true }: { initial: ReminderPrefs; vapidPublicKey: string; frequentSchedule?: boolean }) {
  const t = useTranslations('notifications');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const tp = useTranslations('plan');
  const [enabled, setEnabled] = useState(initial.enabled);
  const [times, setTimes] = useState(initial.times);
  // Capabilities exist only in the browser: 'checking' during server rendering/hydration.
  const env = useSyncExternalStore<Env>(
    noopSubscribe,
    () => (canScheduleNative() ? 'native' : webPushSupported() && vapidPublicKey ? 'web' : 'unsupported'),
    () => 'checking',
  );
  const iosTab = useSyncExternalStore(noopSubscribe, isIosBrowserTab, () => false);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const error = (text: string) => setMsg({ text, tone: 'error' });
      if (enabled && env === 'native' && !(await requestNativePermission())) return error(t('permissionDenied'));
      if (enabled && env === 'web') {
        let sub;
        try {
          sub = await subscribeToPush(vapidPublicKey);
        } catch {
          return error(t('subscribeFailed'));
        }
        if (!sub) return error(t('permissionDenied'));
        const r = await savePushSubscription(sub);
        if (!r.ok) return error(te(r.error));
      }
      const tz = browserTimeZone();
      const res = await saveNotificationPreferences({ enabled, timezone: tz && isValidTimeZone(tz) ? tz : initial.timezone, times });
      if (!res.ok) return error(te(res.error));
      if (!enabled && env === 'web') {
        try {
          const endpoint = await unsubscribeFromPush();
          if (endpoint) await removePushSubscription(endpoint);
        } catch {
          /* the server drops dead subscriptions on its own */
        }
      }
      window.dispatchEvent(new Event(REMINDERS_CHANGED_EVENT));
      setMsg({ text: t('saved'), tone: 'success' });
    });
  };

  return (
    <form onSubmit={submit}>
      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">{t('settingsTitle')}</h2>
        <p className="text-muted">{t('settingsLead')}</p>
        {env === 'unsupported' && <Alert tone="info">{iosTab ? t('iosHint') : t('unsupported')}</Alert>}
        {env === 'web' && !frequentSchedule && <Alert tone="info">{t('limitedSchedule')}</Alert>}
        {env === 'web' && iosTab && <Alert tone="info">{t('iosHint')}</Alert>}
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={enabled} disabled={env === 'unsupported'} onChange={(e) => setEnabled(e.target.checked)} className="mt-1 size-5 accent-[var(--basil)]" />
          <span>
            <span className="font-semibold">{t('enable')}</span>
            <span className="block text-sm text-muted">{t('enableHint')}</span>
          </span>
        </label>
        <fieldset className="grid gap-4 sm:grid-cols-2" disabled={!enabled}>
          <legend className="mb-1 font-semibold">{t('timesLegend')}</legend>
          {MEAL_SLOTS.map((slot) => (
            <Field key={slot} label={tp(`slots.${slot}`)} htmlFor={`rt-${slot}`}>
              <Input id={`rt-${slot}`} type="time" value={times[slot] ?? ''} onChange={(e) => setTimes({ ...times, [slot]: e.target.value || null })} />
            </Field>
          ))}
        </fieldset>
        <p className="text-sm text-muted">
          {t('timeHint')} {t('timezoneNote')}
        </p>
        <div className="flex items-center gap-3">
          <button type="submit" className={buttonClass('primary')} disabled={pending || env === 'checking'}>
            {pending ? tc('saving') : tc('save')}
          </button>
          <LiveMessage message={msg?.text ?? null} tone={msg?.tone} />
        </div>
      </Card>
    </form>
  );
}
