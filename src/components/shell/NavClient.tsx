'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { NavIcon, type IconName } from './icons';
import { cx } from '../ui';

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLink({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx('flex min-h-11 items-center gap-3 rounded-full px-3 font-semibold', active ? 'bg-saffron-wash text-terracotta-deep' : 'text-muted hover:bg-sunk hover:text-ink')}
    >
      <NavIcon name={icon} />
      {label}
    </Link>
  );
}

type Labels = Record<'home' | 'recipes' | 'discover' | 'more' | 'add' | 'addRecipe' | 'importPhoto' | 'importLink' | 'importText' | 'close' | 'main', string>;

export function BottomNav({ labels }: { labels: Labels }) {
  const pathname = usePathname();
  // The sheet is open only for the page where it was opened: navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    setOpenOn(next ? pathname : null);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenOn(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const tab = (href: string, icon: IconName, label: string) => {
    const active = isActive(pathname, href);
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cx('flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.78rem] font-semibold', active ? 'text-terracotta-deep' : 'text-muted')}
      >
        <span className={cx('rounded-full px-4 py-1 motion-safe:transition-colors', active && 'bg-saffron-wash')}>
          <NavIcon name={icon} />
        </span>
        {label}
      </Link>
    );
  };

  return (
    <>
      {open && (
        <div className="no-print fixed inset-0 z-40 bg-[rgb(36_14_27/0.55)] lg:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}
      {open && (
        <div
          id="add-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={labels.add}
          className="sheet-in no-print fixed inset-x-3 bottom-24 z-50 flex flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-float)] lg:hidden"
        >
          {(
            [
              ['/recipes/new', 'plus', labels.addRecipe],
              ['/import/photo', 'camera', labels.importPhoto],
              ['/import/link', 'link', labels.importLink],
              ['/import/text', 'text', labels.importText],
            ] as const
          ).map(([href, icon, label], i) => (
            <Link key={href} href={href} autoFocus={i === 0} className="flex min-h-13 items-center gap-3 rounded-2xl px-3 text-lg font-semibold hover:bg-sunk">
              <span className="flex size-10 items-center justify-center rounded-full bg-basil-wash text-basil">
                <NavIcon name={icon} />
              </span>
              {label}
            </Link>
          ))}
        </div>
      )}
      <nav aria-label={labels.main} className="no-print fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch px-2">
          {tab('/', 'home', labels.home)}
          {tab('/recipes', 'book', labels.recipes)}
          <div className="flex flex-1 items-center justify-center">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="add-sheet"
              aria-label={open ? labels.close : labels.add}
              className="-mt-6 flex size-15 items-center justify-center rounded-full bg-accent text-on-accent shadow-[var(--shadow-raised)] ring-4 ring-porcelain hover:bg-accent-deep motion-safe:transition-[background-color,transform] motion-safe:active:scale-95"
            >
              {open ? <X aria-hidden className="size-7" /> : <Plus aria-hidden className="size-7" />}
            </button>
          </div>
          {tab('/discover', 'compass', labels.discover)}
          {tab('/more', 'menu', labels.more)}
        </div>
      </nav>
    </>
  );
}
