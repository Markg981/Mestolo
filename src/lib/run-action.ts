'use client';

import { useCallback, useTransition } from 'react';

/** Evento globale con cui un'azione fallita (tipicamente per mancanza di rete) avvisa l'utente. */
export const ACTION_ERROR_EVENT = 'mestolo:action-error';

export function reportActionError(error: unknown) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ACTION_ERROR_EVENT, { detail: error }));
}

/**
 * Esegue `fn` senza mai far propagare l'eccezione: senza rete le server action lanciano e,
 * dentro una transizione, l'errore finirebbe nell'error boundary perdendo lo stato dei form.
 * Ritorna true se `fn` e' andata a buon fine.
 */
export async function runAction(fn: () => Promise<unknown> | unknown, onError: (e: unknown) => void = reportActionError): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    onError(e);
    return false;
  }
}

/** Come `useTransition`, ma la funzione passata a `start` e' protetta da try/catch (vedi `runAction`). */
export function useActionTransition(): [boolean, (fn: () => Promise<unknown> | unknown) => void] {
  const [pending, startTransition] = useTransition();
  const start = useCallback((fn: () => Promise<unknown> | unknown) => {
    startTransition(async () => {
      await runAction(fn);
    });
  }, []);
  return [pending, start];
}
