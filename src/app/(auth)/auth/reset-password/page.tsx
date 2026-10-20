import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getUser } from '@/lib/supabase/server';
import { ResetForm } from '../../AuthForms';

export default async function ResetPasswordPage() {
  const user = await getUser();
  if (!user) redirect('/login?error=link');
  const t = await getTranslations('auth');
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-8 sm:py-14">
      <h1 className="display-lg">{t('resetTitle')}</h1>
      <ResetForm />
    </div>
  );
}
