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
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-8 sm:py-14">
      <div className="flex flex-col gap-2">
        <h1 className="display-lg">{t('signupTitle')}</h1>
        <p className="text-muted">{t('signupLead')}</p>
      </div>
      <SignupForm next={next} />
    </div>
  );
}
