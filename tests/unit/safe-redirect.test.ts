import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/safe-redirect';

describe('safeNextPath', () => {
  it('accetta percorsi relativi validi', () => {
    expect(safeNextPath('/')).toBe('/');
    expect(safeNextPath('/recipes/12?tab=a#x')).toBe('/recipes/12?tab=a#x');
    expect(safeNextPath('/auth/reset-password')).toBe('/auth/reset-password');
    expect(safeNextPath('/a%20b')).toBe('/a%20b');
  });

  it.each([
    '/\\evil.com',
    '//evil.com',
    '\\\\evil.com',
    '/\\/evil.com',
    'https://evil.com',
    'http://evil.com/x',
    'javascript:alert(1)',
    'evil.com',
    '',
    '/%2f/evil.com',
    '/%2F%2Fevil.com',
    '/%5cevil.com',
    '/%5Cevil.com',
    '/%252f%252fevil.com',
    '/%255cevil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '/%09/evil.com',
    '/%0d%0aLocation:%20x',
    '/a\u0000b',
    '/%E0%A4%A',
  ])('rifiuta %j', (v) => {
    expect(safeNextPath(v)).toBe('/');
  });

  it('rifiuta valori non stringa e usa il fallback indicato', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath(['/a'])).toBe('/');
    expect(safeNextPath('//x', '/home')).toBe('/home');
  });
});
