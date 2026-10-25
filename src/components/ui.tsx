import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
type Size = 'md' | 'sm' | 'lg';

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', extra?: string) {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors select-none',
    'disabled:opacity-55 disabled:cursor-not-allowed',
    size === 'sm' && 'min-h-11 px-4 text-[0.95rem]',
    size === 'md' && 'min-h-11 px-5',
    size === 'lg' && 'min-h-13 px-7 text-lg',
    variant === 'primary' && 'bg-saffron text-[#2a1a2e] hover:bg-saffron-deep hover:text-[#2a1a2e]',
    variant === 'secondary' && 'bg-surface text-ink border border-line hover:bg-sunk',
    variant === 'ghost' && 'text-ink hover:bg-sunk',
    variant === 'quiet' && 'text-basil underline-offset-4 hover:underline px-1 min-h-11',
    variant === 'danger' && 'bg-tomato text-white hover:opacity-90',
    extra,
  );
}

export function Button({ variant, size, className, ...props }: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button type="button" {...props} className={buttonClass(variant, size, className)} />;
}

export function LinkButton({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

export function Field({ label, hint, error, children, htmlFor, flag }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string; flag?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={htmlFor} className="font-semibold">
          {label}
        </label>
        {flag}
      </div>
      {children}
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && (
        <p className="text-sm font-semibold text-tomato" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'w-full min-h-11 rounded-[var(--radius-field)] border border-line bg-surface px-3.5 py-2 text-ink placeholder:text-muted/80 focus:border-basil';

export function Input(props: ComponentProps<'input'>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Textarea(props: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cx(inputClass, 'min-h-24 leading-relaxed', props.className)} />;
}

export function Select(props: ComponentProps<'select'>) {
  return <select {...props} className={cx(inputClass, 'pr-8', props.className)} />;
}

export function Alert({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'error' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'error' ? XCircle : tone === 'warn' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex gap-3 rounded-2xl border p-4',
        tone === 'info' && 'border-line bg-surface',
        tone === 'warn' && 'border-saffron-deep/40 bg-saffron-wash',
        tone === 'error' && 'border-tomato/40 bg-tomato-wash',
        tone === 'success' && 'border-basil/40 bg-basil-wash',
      )}
    >
      <Icon aria-hidden className={cx('mt-0.5 size-5 shrink-0', tone === 'error' ? 'text-tomato' : tone === 'success' ? 'text-basil' : 'text-ink')} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-[0.97rem] text-ink/90">{children}</div>}
        {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'saffron' | 'basil' | 'tomato' | 'ink'; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.82rem] font-semibold leading-6',
        tone === 'neutral' && 'bg-sunk text-ink',
        tone === 'saffron' && 'bg-saffron-wash text-ink',
        tone === 'basil' && 'bg-basil-wash text-basil',
        tone === 'tomato' && 'bg-tomato-wash text-tomato',
        tone === 'ink' && 'bg-ink text-porcelain',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ illustration, title, children, action }: { illustration?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-surface/60 p-6 sm:p-8">
      {illustration}
      <h2 className="text-xl font-bold">{title}</h2>
      {children && <div className="max-w-prose text-muted">{children}</div>}
      {action && <div className="mt-1 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, lead, actions, back }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:mb-8">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-3xl flex-col gap-2">
          <h1 className="display-lg">{title}</h1>
          {lead && <p className="text-muted">{lead}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6', className)}>{children}</section>;
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Illustration used on empty states: a ladle drawn with simple shapes. */
export function LadleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" aria-hidden className={cx('h-16 w-auto', className)}>
      <ellipse cx="44" cy="54" rx="30" ry="16" fill="var(--saffron)" />
      <ellipse cx="44" cy="50" rx="30" ry="12" fill="var(--saffron-wash)" />
      <path d="M70 46 L112 10" stroke="var(--ink)" strokeWidth="7" strokeLinecap="round" />
      <circle cx="112" cy="10" r="5" fill="var(--ink)" />
    </svg>
  );
}
