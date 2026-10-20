'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { canRefreshNow, debounce } from '@/lib/realtime/helpers';

/**
 * Aggiorna la lista quando un altro membro cambia articoli o reparti.
 * Nessun filtro per owner_id: gli articoli degli altri membri hanno owner diverso;
 * la RLS dell'abbonato limita gli eventi alle liste a cui ha accesso.
 */
export function ShoppingRealtime({ supabaseUrl, supabaseAnonKey }: { supabaseUrl: string; supabaseAnonKey: string }) {
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
    }, 600);
    const channel = supabase.channel('shopping-shared');
    for (const table of ['shopping_items', 'shopping_aisle_overrides']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
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
  }, [supabaseUrl, supabaseAnonKey, router]);
  return null;
}
