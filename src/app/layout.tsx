import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { ServiceWorkerRegister } from '@/components/pwa/PwaClient';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {
    title: { default: 'Mestolo', template: '%s · Mestolo' },
    description: t('description'),
    applicationName: 'Mestolo',
    icons: { icon: '/icon.svg', apple: '/icons/apple-touch-icon.png' },
    appleWebApp: { capable: true, title: 'Mestolo', statusBarStyle: 'default' },
    manifest: '/manifest.webmanifest',
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f6f2' },
    { media: '(prefers-color-scheme: dark)', color: '#1b1320' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>
          {children}
          <ServiceWorkerRegister />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
