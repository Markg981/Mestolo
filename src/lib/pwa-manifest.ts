import type { MetadataRoute } from 'next';
import type { Locale } from '@/i18n/config';

export type ManifestTexts = {
  description: string;
  shortcutAdd: string;
  shortcutImport: string;
  shortcutShopping: string;
};

const SHORTCUT_ICON = [{ src: '/icons/icon-192.png', sizes: '192x192' }];

/** Web App Manifest localizzato: lang, description e nomi degli shortcut seguono la lingua dell'utente. */
export function buildManifest(locale: Locale, t: ManifestTexts): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Mestolo',
    short_name: 'Mestolo',
    description: t.description,
    lang: locale,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#fffdf8',
    theme_color: '#2f6a4f',
    categories: ['food', 'lifestyle'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    shortcuts: [
      { name: t.shortcutAdd, url: '/recipes/new', icons: SHORTCUT_ICON },
      { name: t.shortcutImport, url: '/import/photo', icons: SHORTCUT_ICON },
      { name: t.shortcutShopping, url: '/shopping', icons: SHORTCUT_ICON },
    ],
    // share_target non e ancora nei tipi di MetadataRoute.Manifest
    ...({
      share_target: { action: '/share', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
    } as object),
  };
}
