import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOCALES } from '@/i18n/config';
import { buildManifest } from '@/lib/pwa-manifest';

describe('buildManifest', () => {
  for (const l of LOCALES) {
    it(`usa testi e lang della locale ${l}`, () => {
      const msgs = JSON.parse(readFileSync(`messages/${l}.json`, 'utf8'));
      const m = buildManifest(l, { description: msgs.meta.description, ...msgs.manifest });
      expect(m.lang).toBe(l);
      expect(m.description).toBe(msgs.meta.description);
      expect(m.shortcuts?.map((s) => s.name)).toEqual([
        msgs.manifest.shortcutAdd,
        msgs.manifest.shortcutImport,
        msgs.manifest.shortcutShopping,
      ]);
    });
  }

  it('gli shortcut differiscono tra it e en e il resto resta invariato', () => {
    const it_ = JSON.parse(readFileSync('messages/it.json', 'utf8'));
    const en = JSON.parse(readFileSync('messages/en.json', 'utf8'));
    const a = buildManifest('it', { description: it_.meta.description, ...it_.manifest });
    const b = buildManifest('en', { description: en.meta.description, ...en.manifest });
    expect(a.shortcuts?.[0].name).not.toBe(b.shortcuts?.[0].name);
    expect(a.start_url).toBe(b.start_url);
    expect(a.shortcuts?.map((s) => s.url)).toEqual(b.shortcuts?.map((s) => s.url));
    expect(b).toHaveProperty('share_target');
  });
});
