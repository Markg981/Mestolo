import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/i18n/config';
import { GLOBAL_ERROR_MESSAGES, detectLocale } from './global-error-messages';

describe('global error i18n', () => {
  it('has strings for every locale', () => {
    for (const l of LOCALES) expect(GLOBAL_ERROR_MESSAGES[l].retry).toBeTruthy();
  });
  it('prefers cookie, then html lang, then navigator, then default', () => {
    expect(detectLocale('a=1; mestolo_locale=de', 'fr', 'es')).toBe('de');
    expect(detectLocale('', 'fr-FR', 'es')).toBe('fr');
    expect(detectLocale('', 'xx', 'es-ES')).toBe('es');
    expect(detectLocale('', '', 'xx')).toBe('it');
  });
});
