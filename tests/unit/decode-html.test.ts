import { describe, expect, it } from 'vitest';
import { decodeHtml } from '@/lib/import/decode-html';

const latin1 = (s: string) => Buffer.from(s, 'latin1');
const TEXT = 'Perché è già così, più tardi però';

describe('decodeHtml', () => {
  it('uses the Content-Type charset (ISO-8859-1)', () => {
    expect(decodeHtml(latin1(`<p>${TEXT}</p>`), 'text/html; charset=ISO-8859-1')).toBe(`<p>${TEXT}</p>`);
  });

  it('decodes windows-1252 specifics (euro, curly quotes)', () => {
    const body = Buffer.concat([Buffer.from('<p>'), Buffer.from([0x80, 0x93]), Buffer.from('ciao'), Buffer.from([0x94]), Buffer.from('</p>')]);
    expect(decodeHtml(body, 'text/html; charset=windows-1252')).toBe('<p>€“ciao”</p>');
  });

  it('honours the BOM when the header has no charset', () => {
    const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('è', 'utf8')]);
    expect(decodeHtml(body, 'text/html')).toContain('è');
  });

  it('reads <meta charset>', () => {
    const html = `<html><head><meta charset="iso-8859-1"></head><body>${TEXT}</body></html>`;
    expect(decodeHtml(latin1(html), 'text/html')).toContain(TEXT);
  });

  it('reads <meta http-equiv=Content-Type>', () => {
    const html = `<head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"></head>${TEXT}`;
    expect(decodeHtml(latin1(html))).toContain(TEXT);
  });

  it('prefers the header over the meta tag', () => {
    const html = `<meta charset="utf-8">${TEXT}`;
    expect(decodeHtml(latin1(html), 'text/html; charset=latin1')).toContain(TEXT);
  });

  it('falls back to utf-8', () => {
    expect(decodeHtml(Buffer.from(`<p>${TEXT}</p>`, 'utf8'), 'text/html')).toBe(`<p>${TEXT}</p>`);
  });

  it('ignores unknown labels without throwing', () => {
    expect(decodeHtml(Buffer.from('è', 'utf8'), 'text/html; charset=bogus-9')).toBe('è');
    expect(decodeHtml(Buffer.from('<meta charset="nope">è', 'utf8'))).toContain('è');
  });
});
