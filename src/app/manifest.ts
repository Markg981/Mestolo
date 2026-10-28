import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';
import { resolveLocale } from '@/i18n/request';
import { buildManifest } from '@/lib/pwa-manifest';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = await resolveLocale();
  const [meta, m] = await Promise.all([
    getTranslations({ locale, namespace: 'meta' }),
    getTranslations({ locale, namespace: 'manifest' }),
  ]);
  return buildManifest(locale, {
    description: meta('description'),
    shortcutAdd: m('shortcutAdd'),
    shortcutImport: m('shortcutImport'),
    shortcutShopping: m('shortcutShopping'),
  });
}
