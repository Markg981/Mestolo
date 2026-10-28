/** Recorded fixtures only: no network. */
import { describe, expect, it } from 'vitest';
import { captionsToText, decodeEntities, detectVideoUrl, extractVideoMeta, pickCaptionTrack, sniffCaptionFormat } from '@/lib/import/video';
import { encodeWav8 } from '@/lib/import/audio';

describe('detectVideoUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'youtube', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/abcDEF12345', 'youtube', 'abcDEF12345'],
    ['https://www.tiktok.com/@chef.mario/video/7234567890123456789?lang=it', 'tiktok', '7234567890123456789'],
    ['https://vm.tiktok.com/ZMabc123/', 'tiktok', null],
    ['https://www.instagram.com/reel/Cx1_aBcDeFg/?igsh=xyz', 'instagram', 'Cx1_aBcDeFg'],
    ['https://www.instagram.com/chef/reel/Cx1_aBcDeFg/', 'instagram', 'Cx1_aBcDeFg'],
  ])('%s', (url, platform, id) => {
    expect(detectVideoUrl(url)).toMatchObject({ platform, id });
  });

  it('canonicalises and rejects look-alikes', () => {
    expect(detectVideoUrl('https://youtu.be/dQw4w9WgXcQ')!.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    for (const bad of [
      'https://www.youtube.com/@channel',
      'https://www.youtube.com/watch?v=short',
      'https://evil.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
      'https://www.tiktok.com/@chef',
      'https://www.instagram.com/chef/',
      'ftp://youtu.be/dQw4w9WgXcQ',
      'not a url',
      'https://example.com/ricetta',
    ]) {
      expect(detectVideoUrl(bad), bad).toBeNull();
    }
  });
});

const XML = `<?xml version="1.0" encoding="utf-8" ?><transcript><text start="0" dur="2">Oggi facciamo la carbonara</text><text start="2" dur="3">200 g di guanciale &amp;amp; 4 uova</text><text start="5" dur="2">Non c&amp;#39;&amp;#232; panna</text><text start="7" dur="2">Non c&amp;#39;&amp;#232; panna</text></transcript>`;
const SRV3 = `<timedtext format="3"><body><p t="0" d="2000"><s>Prima</s><s t="500"> il sale</s></p><p t="2000" d="1000">Poi la pasta</p></body></timedtext>`;
const JSON3 = JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: 'Taglia ' }, { utf8: 'la cipolla' }] }, { tStartMs: 1000 }, { tStartMs: 2000, segs: [{ utf8: '\n' }] }, { tStartMs: 3000, segs: [{ utf8: 'Soffriggi' }] }] });
const VTT = `WEBVTT\nKind: captions\nLanguage: it\n\nNOTE commento\n\n00:00:00.000 --> 00:00:02.000 align:start\nMetti <c.colorE5E5E5>l'acqua</c> &amp; il sale\n\n00:00:02.000 --> 00:00:04.000\nMetti l'acqua &amp; il sale\n\n2\n00:00:04.000 --> 00:00:06.000\nCuoci 10 minuti\n`;

describe('captionsToText', () => {
  it('parses timedtext XML (double-escaped entities, duplicate cues)', () => {
    expect(captionsToText(XML)).toBe("Oggi facciamo la carbonara\n200 g di guanciale & 4 uova\nNon c'è panna");
  });
  it('parses srv3 XML with inline segments', () => {
    expect(captionsToText(SRV3)).toBe('Prima il sale\nPoi la pasta');
  });
  it('parses json3', () => {
    expect(captionsToText(JSON3)).toBe('Taglia la cipolla\nSoffriggi');
    expect(captionsToText('{broken')).toBe('');
  });
  it('parses WebVTT (header, notes, tags, repeated cues)', () => {
    expect(captionsToText(VTT)).toBe("Metti l'acqua & il sale\nCuoci 10 minuti");
  });
  it('sniffs the format', () => {
    expect(sniffCaptionFormat(VTT)).toBe('vtt');
    expect(sniffCaptionFormat(JSON3)).toBe('json3');
    expect(sniffCaptionFormat(XML)).toBe('xml');
  });
});

describe('pickCaptionTrack', () => {
  const t = (languageCode: string, kind?: string) => ({ baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`, languageCode, kind });
  it('prefers manual in locale, then auto in locale, then English', () => {
    expect(pickCaptionTrack([t('en'), t('it', 'asr'), t('it')], 'it')).toMatchObject({ languageCode: 'it', kind: undefined });
    expect(pickCaptionTrack([t('en'), t('it', 'asr')], 'it-IT')).toMatchObject({ languageCode: 'it', kind: 'asr' });
    expect(pickCaptionTrack([t('ja'), t('en', 'asr')], 'de')).toMatchObject({ languageCode: 'en' });
    expect(pickCaptionTrack([t('ja', 'asr')], 'de')).toMatchObject({ languageCode: 'ja' });
    expect(pickCaptionTrack([], 'it')).toBeNull();
  });
});

describe('extractVideoMeta', () => {
  const player = {
    videoDetails: { title: 'Carbonara perfetta', shortDescription: 'Ingredienti:\n200 g guanciale\n4 uova\n\nProcedimento:\n1. Cuoci la pasta' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=it', languageCode: 'it', kind: 'asr' }] } },
  };
  const ytHtml = `<html><head><title>x - YouTube</title></head><body><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = {};</script></body></html>`;

  it('reads description and caption tracks from the YouTube player response', () => {
    const m = extractVideoMeta(ytHtml);
    expect(m.title).toBe('Carbonara perfetta');
    expect(m.description).toContain('200 g guanciale');
    expect(m.captionTracks).toEqual([{ baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=it', languageCode: 'it', kind: 'asr' }]);
  });

  it('reads JSON-LD VideoObject', () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'VideoObject', name: 'Tiramisù', description: 'Mascarpone 500 g\nSavoiardi' })}</script></head></html>`;
    const m = extractVideoMeta(html);
    expect(m).toMatchObject({ title: 'Tiramisù', captionTracks: [] });
    expect(m.description).toContain('Savoiardi');
  });

  it('falls back to og/meta tags (Reels, TikTok)', () => {
    const html = `<html><head><meta property="og:title" content="Chef su Instagram"><meta property="og:description" content="Pasta al forno &amp; besciamella: 500 g di pasta"></head></html>`;
    const m = extractVideoMeta(html);
    expect(m.title).toBe('Chef su Instagram');
    expect(m.description).toBe('Pasta al forno & besciamella: 500 g di pasta');
  });

  it('returns empty values for a page with nothing useful', () => {
    expect(extractVideoMeta('<html><body>login</body></html>')).toEqual({ title: '', description: '', captionTracks: [] });
  });
});

describe('encodeWav8', () => {
  it('writes a valid 8-bit mono header', () => {
    const wav = encodeWav8(new Float32Array([-1, 0, 1]), 8000);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint16(34, true)).toBe(8);
    expect(v.getUint32(40, true)).toBe(3);
    expect([...wav.slice(44)]).toEqual([0, 128, 255]);
  });
});

describe('decodeEntities', () => {
  it('decodifica entita valide', () => {
    expect(decodeEntities('a &#65; &#x42; &amp; &lt;')).toBe('a A B & <');
  });
  it('non lancia su code point fuori range o surrogati e lascia l entita intatta', () => {
    expect(() => decodeEntities('&#99999999;')).not.toThrow();
    expect(decodeEntities('x &#99999999; y')).toBe('x &#99999999; y');
    expect(decodeEntities('&#x110000;')).toBe('&#x110000;');
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
    expect(decodeEntities('&#0;')).toBe('&#0;');
  });
});
