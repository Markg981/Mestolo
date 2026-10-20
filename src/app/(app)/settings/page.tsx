import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { createClient, getProfile, getUser } from '@/lib/supabase/server';
import { PREFS_COLUMNS, rowToPrefs, type PrefsRow } from '@/lib/notifications/schedule';
import { listCategories } from '@/lib/data/recipes';
import { categoryLabel } from '@/lib/recipes/categories';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { SupportContact } from '@/components/SupportContact';
import { Card, PageHeader } from '@/components/ui';
import { ProfileForm, CustomCategories } from './SettingsForms';
import { NotificationSettings } from './NotificationSettings';

export async function generateMetadata() {
  const t = await getTranslations('settings');
  return { title: t('title') };
}

export default async function SettingsPage() {
  const [t, profile, categories, user] = await Promise.all([getTranslations(), getProfile(), listCategories(), getUser()]);
  const { data: prefsRow } = user ? await (await createClient()).from('notification_preferences').select(PREFS_COLUMNS).eq('user_id', user.id).maybeSingle() : { data: null };
  const system = categories.filter((c) => c.owner_id === null && c.slug !== 'uncategorized').map((c) => ({ slug: c.slug, label: categoryLabel(c, t) }));
  const custom = categories.filter((c) => c.owner_id !== null).map((c) => ({ id: c.id, name: c.name ?? c.slug }));
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('settings.title')} />
      <nav aria-label={t('settings.sections')} className="flex flex-wrap gap-2">
        <Link href="/settings/ai" className="rounded-full border border-line bg-surface px-4 py-2.5 font-semibold hover:bg-sunk">
          {t('settings.aiLink')}
        </Link>
        <Link href="/settings/account" className="rounded-full border border-line bg-surface px-4 py-2.5 font-semibold hover:bg-sunk">
          {t('settings.accountLink')}
        </Link>
        <Link href="/privacy" className="rounded-full border border-line bg-surface px-4 py-2.5 font-semibold hover:bg-sunk">
          {t('settings.privacyLink')}
        </Link>
        <Link href="/terms" className="rounded-full border border-line bg-surface px-4 py-2.5 font-semibold hover:bg-sunk">
          {t('settings.termsLink')}
        </Link>
        {profile?.is_moderator && (
          <Link href="/moderation" className="rounded-full border border-line bg-surface px-4 py-2.5 font-semibold hover:bg-sunk">
            {t('nav.moderation')}
          </Link>
        )}
      </nav>
      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">{t('settings.languageTitle')}</h2>
        <p className="text-muted">{t('settings.languageLead')}</p>
        <LanguageSwitcher />
      </Card>
      {profile && <ProfileForm profile={profile} systemCategories={system} />}
      <NotificationSettings initial={rowToPrefs(prefsRow as PrefsRow | null)} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''} />
      <CustomCategories categories={custom} />
      <Card>
        <SupportContact />
      </Card>
    </div>
  );
}
