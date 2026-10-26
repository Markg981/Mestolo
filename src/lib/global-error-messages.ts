import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from '@/i18n/config';

// global-error renders outside the root layout (no next-intl provider), so strings live here.
export const GLOBAL_ERROR_MESSAGES: Record<Locale, { title: string; body: string; retry: string }> = {
  it: { title: 'Questa pagina non si è caricata', body: 'Si è verificato un errore imprevisto. Riprova.', retry: 'Riprova' },
  en: { title: "This page didn't load", body: 'An unexpected error occurred. Please try again.', retry: 'Try again' },
  es: { title: 'Esta página no se ha cargado', body: 'Se ha producido un error inesperado. Inténtalo de nuevo.', retry: 'Reintentar' },
  fr: { title: "Cette page ne s'est pas chargée", body: "Une erreur inattendue s'est produite. Réessayez.", retry: 'Réessayer' },
  de: { title: 'Diese Seite wurde nicht geladen', body: 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es erneut.', retry: 'Erneut versuchen' },
  pt: { title: 'Esta página não foi carregada', body: 'Ocorreu um erro inesperado. Tente novamente.', retry: 'Tentar novamente' },
};

/** Locale from the locale cookie, then <html lang>, then navigator.language, else the default. */
export function detectLocale(cookie?: string, htmlLang?: string, navLang?: string): Locale {
  const m = cookie?.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`));
  const fromCookie = m?.[1];
  if (isLocale(fromCookie)) return fromCookie;
  for (const l of [htmlLang, navLang]) {
    const code = l?.slice(0, 2).toLowerCase();
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}
