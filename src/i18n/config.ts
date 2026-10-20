/**
 * Supported interface languages. To add a language: add its code here,
 * add messages/<code>.json with the same keys as it.json (a unit test checks it),
 * and add its native name to LOCALE_NAMES. No screen needs to change.
 */
export const LOCALES = ['it', 'en', 'es', 'fr', 'de', 'pt'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'it';
export const LOCALE_COOKIE = 'mestolo_locale';

export const LOCALE_NAMES: Record<Locale, string> = {
  it: 'Italiano',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** Picks the best supported locale from an Accept-Language header. */
export function matchAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const prefs = header
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { lang: tag.slice(0, 2).toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const p of prefs) if (isLocale(p.lang)) return p.lang;
  return DEFAULT_LOCALE;
}

/** Languages a recipe can be written in (wider than the UI list). */
export const RECIPE_LANGUAGES = ['it', 'en', 'es', 'fr', 'de', 'pt', 'nl', 'pl', 'ro', 'el', 'tr', 'ja', 'zh', 'ar', 'hi'] as const;
