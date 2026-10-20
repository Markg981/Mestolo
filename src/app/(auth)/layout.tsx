import Link from 'next/link';
import { Logo } from '@/components/shell/AppShell';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/welcome" aria-label="Mestolo">
          <Logo />
        </Link>
        <LanguageSwitcher />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-16 sm:px-6">
        {children}
      </main>
    </div>
  );
}
