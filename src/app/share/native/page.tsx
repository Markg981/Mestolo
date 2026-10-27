'use client';

import { useEffect } from 'react';
import { resolveShareTarget, SHARED_TEXT_KEY } from '@/lib/import/share-fragment';

/**
 * Destinazione dello share dell'app Android (MainActivity). Il contenuto arriva nel fragment
 * (#text=...), che non raggiunge il server: lo si legge, si ripulisce la history e si passa
 * all'import. Il testo libero resta in sessionStorage, mai nell'URL.
 */
export default function NativeSharePage() {
  useEffect(() => {
    const { path, text } = resolveShareTarget(window.location.hash);
    window.history.replaceState(null, '', window.location.pathname);
    if (text) {
      try {
        sessionStorage.setItem(SHARED_TEXT_KEY, text);
      } catch {
        // storage non disponibile: si apre l'import vuoto
      }
    }
    window.location.replace(path);
  }, []);
  return null;
}
