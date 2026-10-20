import { describe, expect, it } from 'vitest';
import { appUrlToPath } from '@/lib/import/share-url';

describe('appUrlToPath', () => {
  it('routes a shared URL to the link import', () => {
    expect(appUrlToPath('mestolo://share?url=https%3A%2F%2Fcucina.example%2Fragu')).toBe('/import/link?url=https%3A%2F%2Fcucina.example%2Fragu');
  });
  it('finds a link inside shared text', () => {
    expect(appUrlToPath('mestolo://share?text=Guarda%20https%3A%2F%2Fa.example%2Fb%21')).toBe('/import/link?url=https%3A%2F%2Fa.example%2Fb');
  });
  it('routes plain text to the text import', () => {
    expect(appUrlToPath('mestolo://share?text=2%20uova')).toBe('/import/text?text=2%20uova');
  });
  it('falls back to the link import when empty', () => {
    expect(appUrlToPath('mestolo://share')).toBe('/import/link');
  });
  it('ignores other schemes, hosts and garbage', () => {
    expect(appUrlToPath('https://x.example/share?url=a')).toBeNull();
    expect(appUrlToPath('mestolo://other?url=a')).toBeNull();
    expect(appUrlToPath('not a url')).toBeNull();
  });
});
