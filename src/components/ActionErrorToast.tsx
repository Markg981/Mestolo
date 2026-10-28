'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTION_ERROR_EVENT } from '@/lib/run-action';

const TOAST_MS = 6000;

/**
 * Avviso globale per le azioni fallite (vedi `runAction`): la pagina resta montata e i form non si perdono.
 * WCAG 2.2.1: ha un pulsante di chiusura e il timer e sospeso con hover o focus.
 */
export function ActionErrorToast() {
  const t = useTranslations('common');
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const stop = useCallback(() => clearTimeout(timer.current), []);
  const start = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), TOAST_MS);
  }, []);

  useEffect(() => {
    const onError = () => {
      setShown(true);
      start();
    };
    window.addEventListener(ACTION_ERROR_EVENT, onError);
    return () => {
      window.removeEventListener(ACTION_ERROR_EVENT, onError);
      clearTimeout(timer.current);
    };
  }, [start]);

  if (!shown) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <div
        role="alert"
        aria-live="assertive"
        onMouseEnter={stop}
        onMouseLeave={start}
        onFocus={stop}
        onBlur={start}
        className="pointer-events-auto flex max-w-md items-center gap-2 rounded-xl bg-tomato py-1 pl-4 pr-1 text-sm font-semibold text-white shadow-lg"
      >
        <p className="py-2">{t('actionFailed')}</p>
        <button
          type="button"
          onClick={() => {
            stop();
            setShown(false);
          }}
          aria-label={t('close')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg leading-none hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}
