import { sharedToImportPath } from '@/lib/import/share';

/** Custom URL scheme registered by the iOS app (see docs/ios-share-extension.md). */
export const APP_URL_SCHEME = 'mestolo';

/**
 * Maps a deep link opened in the native app (e.g. `mestolo://share?url=...&text=...`, sent by the
 * iOS Share Extension) to an in-app path. Returns null for links that are not share links.
 */
export function appUrlToPath(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== `${APP_URL_SCHEME}:` || u.hostname !== 'share') return null;
  const p = u.searchParams;
  return sharedToImportPath({ url: p.get('url'), text: p.get('text'), title: p.get('title') });
}
