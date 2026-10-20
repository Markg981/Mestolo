import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getProfile } from '@/lib/supabase/server';
import { Card, PageHeader, buttonClass } from '@/components/ui';
import { DeleteAccountForm } from '../SettingsForms';

export default async function AccountPage() {
  const [t, profile] = await Promise.all([getTranslations('account'), getProfile()]);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t('title')}
        back={
          <Link href="/settings" className="text-basil underline underline-offset-4">
            {t('back')}
          </Link>
        }
      />
      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">{t('exportTitle')}</h2>
        <p className="text-muted">{t('exportLead')}</p>
        <div>
          <a href="/api/account/export" className={buttonClass('secondary')}>
            {t('exportButton')}
          </a>
        </div>
      </Card>
      <Card className="flex flex-col gap-3 border-tomato/40">
        <h2 className="text-xl font-bold text-tomato">{t('deleteTitle')}</h2>
        <p>{t('deleteLead')}</p>
        {profile && <DeleteAccountForm username={profile.username} />}
      </Card>
    </div>
  );
}
