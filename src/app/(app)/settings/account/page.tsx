import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getProfile } from '@/lib/supabase/server';
import { Card, PageHeader, buttonClass } from '@/components/ui';
import { ChangePasswordForm, DeleteAccountForm } from '../SettingsForms';

export default async function AccountPage() {
  const [t, profile] = await Promise.all([getTranslations('account'), getProfile()]);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t('title')}
        back={
          <Link href="/settings" className="inline-flex min-h-11 items-center self-start text-terracotta-deep underline underline-offset-4">
            {t('back')}
          </Link>
        }
      />
      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">{t('exportTitle')}</h2>
        <p className="text-muted">{t('exportLead')}</p>
        <div className="flex flex-wrap gap-3">
          <form action="/api/account/export" method="post">
            <button type="submit" className={buttonClass('secondary')}>
              {t('exportButton')}
            </button>
          </form>
          <Link href="/import/file" className={buttonClass('secondary')}>
            {t('importButton')}
          </Link>
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">{t('passwordTitle')}</h2>
        <p className="text-muted">{t('passwordLead')}</p>
        <ChangePasswordForm />
      </Card>
      <Card className="flex flex-col gap-3 border-tomato/40">
        <h2 className="text-xl font-bold text-tomato">{t('deleteTitle')}</h2>
        <p>{t('deleteLead')}</p>
        {profile && <DeleteAccountForm username={profile.username} />}
      </Card>
    </div>
  );
}
