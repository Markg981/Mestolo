'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { REALTIME_TABLES, canRefreshNow, debounce, userFilter } from './helpers';

const DEBOUNCE_MS = 800;

/**
 * Subscribes to postgres_changes on the user's own rows and calls
 * router.refresh() (debounced) when another device changes them. The user's own
 * actions already refresh, so the extra event just coalesces into one refresh.
 * Paused while the tab is hidden (one refresh on return) and offline.
 */
export function useRealtimeRefresh(userId: string, supabaseUrl: string, supabaseAnonKey: string) {
  const router = useRouter();

  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) return;
    const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
    let missed = false;
    const ready = () => canRefreshNow(document.visibilityState === 'visible', navigator.onLine);
    const refresh = debounce(() => {
      if (!ready()) {
        missed = true;
        return;
      }
      missed = false;
      router.refresh();
    }, DEBOUNCE_MS);

    const channel = supabase.channel(`sync:${userId}`);
    for (const { table, column } of REALTIME_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: userFilter(column, userId) }, refresh);
    }
    channel.subscribe();

    const resume = () => {
      if (missed && ready()) refresh();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);

    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      refresh.cancel();
      void supabase.removeChannel(channel);
    };
  }, [userId, supabaseUrl, supabaseAnonKey, router]);
}
