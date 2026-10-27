'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ACTION_ERROR_EVENT } from '@/lib/run-action';

/** Avviso globale per le azioni fallite (vedi `runAction`): la pagina resta montata e i form non si perdono. */
export function ActionErrorToast() {
  const t = useTranslations('common');
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onError = () => {
      setShown(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setShown(false), 6000);
    };
    window.addEventListener(ACTION_ERROR_EVENT, onError);
    return () => {
      window.removeEventListener(ACTION_ERROR_EVENT, onError);
      clearTimeout(timer.current);
    };
  }, []);

  if (!shown) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <p role="alert" aria-live="assertive" className="pointer-events-auto max-w-md rounded-xl bg-tomato px-4 py-3 text-sm font-semibold text-white shadow-lg">{t('actionFailed')}</p>
    </div>
  );
}
