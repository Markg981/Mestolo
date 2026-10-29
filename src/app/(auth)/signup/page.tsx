import { getTranslations } from 'next-intl/server';
import { SignupForm } from '../AuthForms';

export async function generateMetadata() {
  const t = await getTranslations('auth');
  return { title: t('signupTitle') };
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const t = await getTranslations('auth');
  const { next } = await searchParams;
  return (
    <div className="auth-panel mx-auto mb-4 flex w-full max-w-md flex-col gap-6 p-6 sm:mb-12 sm:p-10">
      <div className="flex flex-col gap-2">
        <h1 className="display-lg">{t('signupTitle')}</h1>
        <p className="text-muted">{t('signupLead')}</p>
      </div>
      <SignupForm next={next} />
    </div>
  );
}
