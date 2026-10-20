'use client';

import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh';

/** Mounted once in the app layout: keeps the open devices/tabs in sync. */
export function RealtimeSync({ userId, supabaseUrl, supabaseAnonKey }: { userId: string; supabaseUrl: string; supabaseAnonKey: string }) {
  useRealtimeRefresh(userId, supabaseUrl, supabaseAnonKey);
  return null;
}
