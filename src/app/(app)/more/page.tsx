import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { NavIcon } from '@/components/shell/icons';
import { SECONDARY_NAV } from '@/components/shell/nav-items';
import { signOut } from '@/app/actions/auth';
import { SignOutButton } from '@/components/pwa/PwaClient';
import { getProfile } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui';

export default async function MorePage() {
  const [t, profile] = await Promise.all([getTranslations('nav'), getProfile()]);
  return (
    <div>
      <PageHeader title={t('more')} />
      <ul className="flex flex-col gap-2">
        {SECONDARY_NAV.map((n) => (
          <li key={n.href}>
            <Link href={n.href} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-lg font-semibold hover:bg-sunk">
              <NavIcon name={n.icon} />
              {t(n.key)}
            </Link>
          </li>
        ))}
        {profile?.is_moderator && (
          <li>
            <Link href="/moderation" className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-lg font-semibold hover:bg-sunk">
              <NavIcon name="shield" />
              {t('moderation')}
            </Link>
          </li>
        )}
        {profile && (
          <li>
            <Link href={`/u/${profile.username}`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-lg font-semibold hover:bg-sunk">
              <NavIcon name="users" />
              {t('myProfile')}
            </Link>
          </li>
        )}
      </ul>
      <div className="mt-6">
        <SignOutButton action={signOut} label={t('signOut')} className="min-h-12 rounded-full px-4 font-semibold text-muted hover:bg-sunk hover:text-ink" />
      </div>
    </div>
  );
}
