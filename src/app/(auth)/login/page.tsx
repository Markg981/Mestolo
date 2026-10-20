import { getTranslations } from 'next-intl/server';
import { LoginForm } from '../AuthForms';
import { ClearUserCacheOnMount } from '@/components/pwa/PwaClient';

export async function generateMetadata() {
  const t = await getTranslations('auth');
  return { title: t('loginTitle') };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const t = await getTranslations('auth');
  const { next, error } = await searchParams;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-8 sm:py-14">
      <h1 className="display-lg">{t('loginTitle')}</h1>
      <LoginForm next={next} linkError={error === 'link'} />
      <ClearUserCacheOnMount />
    </div>
  );
}
