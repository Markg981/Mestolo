'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { X } from 'lucide-react';
import { buttonClass, cx } from './ui';

export function SubmitButton({ children, pendingLabel, variant = 'primary', className, disabled }: { children: ReactNode; pendingLabel: string; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-disabled={pending || disabled} className={buttonClass(variant, 'md', className)}>
      {pending && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />}
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Accessible modal built on the native <dialog> element (focus trap + Esc handled by the browser). */
export function Modal({ open, onClose, title, children, closeLabel }: { open: boolean; onClose: () => void; title: string; children: ReactNode; closeLabel: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Id unico: con un id fisso piu' modali nella stessa pagina prendevano tutte il titolo della prima
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink shadow-2xl"
    >
      <div className="sheet-in flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-xl font-bold">
            {title}
          </h2>
          <button type="button" onClick={onClose} className={cx(buttonClass('ghost', 'sm'), 'size-10 px-0')} aria-label={closeLabel}>
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** Polite live region for transient feedback ("Saved", "Added to list"). */
export function LiveMessage({ message, tone = 'success' }: { message: string | null; tone?: 'success' | 'error' }) {
  return (
    <p aria-live="polite" role="status" className={cx('min-h-6 text-sm font-semibold', tone === 'error' ? 'text-tomato' : 'text-basil')}>
      {message}
    </p>
  );
}
