import { getTranslations } from 'next-intl/server';
import { ForgotForm } from '../AuthForms';

export default async function ForgotPage() {
  const t = await getTranslations('auth');
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-8 sm:py-14">
      <div className="flex flex-col gap-2">
        <h1 className="display-lg">{t('forgotTitle')}</h1>
        <p className="text-muted">{t('forgotLead')}</p>
      </div>
      <ForgotForm />
    </div>
  );
}
