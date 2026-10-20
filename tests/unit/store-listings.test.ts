import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'store');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r?\n$/, '');

const ANDROID_FILES: Record<string, number> = {
  'title.txt': 30,
  'short_description.txt': 80,
  'full_description.txt': 4000,
  'changelogs/default.txt': 500,
};
const IOS_FILES: Record<string, number> = {
  'name.txt': 30,
  'subtitle.txt': 30,
  'keywords.txt': 100,
  'promotional_text.txt': 170,
  'description.txt': 4000,
  'release_notes.txt': 4000,
  'privacy_url.txt': 500,
  'support_url.txt': 500,
};

function locales(platform: string): string[] {
  return readdirSync(join(ROOT, platform), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

describe.each([
  ['android', ANDROID_FILES],
  ['ios', IOS_FILES],
] as const)('schede store %s', (platform, files) => {
  const locs = locales(platform);

  it('ha almeno it-IT ed en-US', () => {
    expect(locs).toContain('it-IT');
    expect(locs).toContain('en-US');
  });

  it('tutte le lingue hanno gli stessi locali dell\'altra piattaforma', () => {
    expect(locs.sort()).toEqual(locales(platform === 'android' ? 'ios' : 'android').sort());
  });

  for (const loc of locs) {
    for (const [file, max] of Object.entries(files)) {
      it(`${loc}/${file}: presente, non vuoto, max ${max} caratteri`, () => {
        const path = join(ROOT, platform, loc, file);
        expect(existsSync(path), `manca ${path}`).toBe(true);
        const text = read(path);
        expect(text.trim().length).toBeGreaterThan(0);
        expect([...text].length).toBeLessThanOrEqual(max);
      });
    }
  }
});

describe('parole chiave iOS', () => {
  for (const loc of locales('ios')) {
    it(`${loc}: separate da virgole, senza spazi dopo la virgola`, () => {
      const kw = read(join(ROOT, 'ios', loc, 'keywords.txt'));
      expect(kw).not.toMatch(/\s/);
      expect(kw).not.toMatch(/,,|^,|,$/);
    });
  }
});

describe('URL', () => {
  for (const loc of locales('ios')) {
    it(`${loc}: usa il segnaposto {{SITE_URL}}`, () => {
      expect(read(join(ROOT, 'ios', loc, 'privacy_url.txt'))).toMatch(/^\{\{SITE_URL\}\}/);
      expect(read(join(ROOT, 'ios', loc, 'support_url.txt'))).toMatch(/^\{\{SITE_URL\}\}/);
    });
  }
});
