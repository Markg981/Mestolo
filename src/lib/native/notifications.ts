'use client';

import { Capacitor } from '@capacitor/core';
import type { ScheduledReminder } from '@/lib/notifications/schedule';

/** True only inside the Android/iOS app when the LocalNotifications plugin is part of the installed build. */
export function canScheduleNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications');
  } catch {
    return false;
  }
}

/** Asks the OS for the notification permission; true when granted. */
export async function requestNativePermission(): Promise<boolean> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const current = await LocalNotifications.checkPermissions();
  if (current.display === 'granted') return true;
  return (await LocalNotifications.requestPermissions()).display === 'granted';
}

/**
 * Replaces every pending local notification with `reminders` (cancel and reschedule by id).
 * With no reminders it just clears the pending ones. Never prompts for permission.
 */
export async function replaceNativeReminders(reminders: ScheduledReminder[], text: (r: ScheduledReminder) => { title: string; body: string }): Promise<void> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length > 0) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  if (reminders.length === 0) return;
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
  await LocalNotifications.schedule({
    notifications: reminders.map((r) => {
      const { title, body } = text(r);
      return { id: r.id, title, body, schedule: { at: r.at, allowWhileIdle: true }, extra: { url: '/plan' } };
    }),
  });
}
