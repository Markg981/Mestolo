import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { NavIcon } from './icons';
import { PRIMARY_NAV, QUICK_ACTIONS, SECONDARY_NAV } from './nav-items';
import { BottomNav, NavLink } from './NavClient';
import { signOut } from '@/app/actions/auth';
import { OfflineBanner, SignOutButton } from '@/components/pwa/PwaClient';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg viewBox="0 0 64 64" aria-hidden className="size-8">
        <rect width="64" height="64" rx="16" fill="var(--ink)" />
        <path d="M38 10c-3 0-5 2-5 5v16c0 2-1 3-3 3h-1c-6 0-11 5-11 11s5 11 11 11 11-5 11-11V15c0-3-1-5-2-5z" fill="var(--saffron)" />
        <circle cx="29" cy="45" r="5" fill="var(--ink)" />
      </svg>
      <span className="font-display text-2xl font-extrabold tracking-tight" style={{ fontStretch: '82%' }}>
        Mestolo
      </span>
    </span>
  );
}

export async function AppShell({ children, username, isModerator = false }: { children: React.ReactNode; username: string; isModerator?: boolean }) {
  const t = await getTranslations('nav');
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      <a href="#main" className="skip-link">
        {t('skip')}
      </a>

      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-r border-line bg-surface px-4 py-6 lg:flex">
        <Link href="/" className="px-2">
          <Logo />
        </Link>
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-saffron-wash p-3">
          {QUICK_ACTIONS.map((a) => (
            <Link key={a.href} href={a.href} className="flex min-h-11 items-center gap-3 rounded-xl px-3 font-semibold hover:bg-saffron/40">
              <NavIcon name={a.icon} />
              {t(a.key)}
            </Link>
          ))}
        </div>
        <nav aria-label={t('main')} className="flex flex-col gap-1">
          {[...PRIMARY_NAV, ...SECONDARY_NAV].map((n) => (
            <NavLink key={n.href} href={n.href} icon={n.icon} label={t(n.key)} />
          ))}
          {isModerator && <NavLink href="/moderation" icon="shield" label={t('moderation')} />}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-line pt-4">
          <Link href={`/u/${username}`} className="truncate px-3 text-sm text-muted hover:text-ink">
            @{username}
          </Link>
          <SignOutButton action={signOut} label={t('signOut')} className="min-h-11 w-full rounded-xl px-3 text-left font-semibold text-muted hover:bg-sunk hover:text-ink" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <OfflineBanner />
        {/* Mobile top bar */}
        <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-line bg-porcelain/95 px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur lg:hidden">
          <Link href="/" aria-label="Mestolo">
            <Logo />
          </Link>
          <Link href="/more" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-sunk" aria-label={t('more')}>
            <NavIcon name="menu" className="size-6" />
          </Link>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-32 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
          {children}
        </main>

        <BottomNav
          labels={{
            home: t('home'),
            recipes: t('recipes'),
            discover: t('discover'),
            more: t('more'),
            add: t('add'),
            addRecipe: t('addRecipe'),
            importPhoto: t('importPhoto'),
            importLink: t('importLink'),
            importText: t('importText'),
            close: t('close'),
            main: t('main'),
          }}
        />
      </div>
    </div>
  );
}
