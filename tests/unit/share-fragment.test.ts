import { describe, expect, it } from 'vitest';
import { parseShareFragment, resolveShareTarget } from '@/lib/import/share-fragment';

describe('share-fragment (share Android)', () => {
  it('legge i parametri dal fragment', () => {
    expect(parseShareFragment('#text=a%20b&title=T')).toEqual({ url: null, text: 'a b', title: 'T' });
  });
  it('un link condiviso apre /import/link', () => {
    expect(resolveShareTarget('#text=Guarda%20https%3A%2F%2Fa.example%2Fb')).toEqual({ path: '/import/link?url=https%3A%2F%2Fa.example%2Fb', text: null });
  });
  it("il testo libero non finisce nell'URL", () => {
    const r = resolveShareTarget('#text=2%20uova%20%26%20100%25%20farina');
    expect(r.path).toBe('/import/text');
    expect(r.text).toBe('2 uova & 100% farina');
  });
  it('senza contenuto apre /import/link', () => {
    expect(resolveShareTarget('')).toEqual({ path: '/import/link', text: null });
  });
});
