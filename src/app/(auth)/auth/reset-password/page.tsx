import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getUser } from '@/lib/supabase/server';
import { ResetForm } from '../../AuthForms';

export default async function ResetPasswordPage() {
  const user = await getUser();
  if (!user) redirect('/login?error=link');
  const t = await getTranslations('auth');
  return (
    <div className="auth-panel mx-auto mb-4 flex w-full max-w-md flex-col gap-6 p-6 sm:mb-12 sm:p-10">
      <h1 className="display-lg">{t('resetTitle')}</h1>
      <ResetForm />
    </div>
  );
}
