/**
 * Real OCR end to end: the real tesseract.js engine reads an image, then layout, cleaning and the
 * recipe parser run on its actual output (boxes, line breaks, misreads). Only the browser bits are
 * replaced: decodeToCanvas (the engine accepts the image buffer) and the same-origin /ocr paths
 * (language data is read from node_modules, like scripts/copy-ocr-assets.mjs does).
 *
 * The synthetic card is rendered with a slight tilt, blur and JPEG noise. Real photos can be added
 * to tests/fixtures/ocr as <name>.jpg + <name>.json ({ "locale", "contains", "minIngredients" }).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('@/lib/ocr/image', () => ({ decodeToCanvas: async (blob: Blob) => Buffer.from(await blob.arrayBuffer()) }));
vi.mock('tesseract.js', async (orig) => {
  const real = await orig<typeof import('tesseract.js')>();
  return {
    ...real,
    createWorker: (lang: string, oem: number, opts: { logger?: (m: unknown) => void }) =>
      real.createWorker(lang, oem, { langPath: join('node_modules', '@tesseract.js-data', lang, '4.0.0_best_int'), cacheMethod: 'none', logger: opts.logger }),
  };
});

import { recognizeWithTesseract } from '@/lib/ocr/tesseract';
import { cleanOcrText } from '@/lib/ocr/clean';
import { parseRecipeText } from '@/lib/recipes/text-parser';

const BG = '#f4efe4';
const text = (x: number, y: number, s: string, size = 44) =>
  `<text x="${x}" y="${y}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="${size}" fill="#222">${s}</text>`;

/** A two-column card: ingredients on the left, method on the right. */
async function card(): Promise<Blob> {
  const left = ['Ingredienti', '300 g di farina 00', '1/2 cucchiaino di sale', '2 uova', '100 ml di latte'];
  const right = ['Procedimento', '1. Impastare farina e uova.', '2. Aggiungere il latte.', '3. Cuocere 20 minuti.'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800">
    <rect width="100%" height="100%" fill="${BG}"/>
    ${text(70, 90, 'Torta semplice', 60)}
    ${left.map((s, i) => text(70, 200 + i * 90, s)).join('')}
    ${right.map((s, i) => text(820, 200 + i * 90, s)).join('')}
  </svg>`;
  const jpg = await sharp(Buffer.from(svg)).rotate(1.5, { background: BG }).blur(0.7).jpeg({ quality: 60 }).toBuffer();
  return new Blob([new Uint8Array(jpg)], { type: 'image/jpeg' });
}

describe('real OCR (tesseract.js) to recipe', () => {
  it('reads a tilted two-column card into ingredients and steps', async () => {
    const progress: number[] = [];
    const raw = await recognizeWithTesseract(await card(), 'it', (p) => progress.push(p));
    expect(progress.at(-1)).toBe(1);
    // the layout step keeps the left column together, before the method
    expect(raw.indexOf('uova')).toBeLessThan(raw.indexOf('Procedimento'));

    const r = parseRecipeText(cleanOcrText(raw));
    const ing = (name: string) => r.ingredients.find((i) => i.name.toLowerCase().includes(name));
    expect(ing('farina')).toMatchObject({ quantity: 300, unit: 'g' });
    expect(ing('sale')).toMatchObject({ quantity: 0.5, unit: 'tsp' });
    expect(ing('uova')).toMatchObject({ quantity: 2 });
    expect(ing('latte')).toMatchObject({ quantity: 100, unit: 'ml' });
    expect(r.steps.length).toBeGreaterThanOrEqual(3);
    expect(r.steps.map((s) => s.text).join(' ')).toMatch(/latte/i);
  }, 60_000);

  const dir = join('tests', 'fixtures', 'ocr');
  const photos = existsSync(dir) ? readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)) : [];
  it.skipIf(!photos.length).each(photos)('reads the photo %s', async (file) => {
    const exp = JSON.parse(readFileSync(join(dir, file.replace(/\.jpe?g$/i, '.json')), 'utf8')) as { locale: string; contains: string[]; minIngredients: number };
    const r = parseRecipeText(cleanOcrText(await recognizeWithTesseract(new Blob([new Uint8Array(readFileSync(join(dir, file)))]), exp.locale)));
    expect(r.ingredients.length).toBeGreaterThanOrEqual(exp.minIngredients);
    const names = r.ingredients.map((i) => i.name.toLowerCase()).join(' | ');
    for (const c of exp.contains) expect(names).toContain(c.toLowerCase());
  }, 120_000);
});
