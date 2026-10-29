import { getTranslations } from 'next-intl/server';
import { ForgotForm } from '../AuthForms';

export default async function ForgotPage() {
  const t = await getTranslations('auth');
  return (
    <div className="auth-panel mx-auto mb-4 flex w-full max-w-md flex-col gap-6 p-6 sm:mb-12 sm:p-10">
      <div className="flex flex-col gap-2">
        <h1 className="display-lg">{t('forgotTitle')}</h1>
        <p className="text-muted">{t('forgotLead')}</p>
      </div>
      <ForgotForm />
    </div>
  );
}
