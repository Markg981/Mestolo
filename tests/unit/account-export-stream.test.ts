import { describe, expect, it } from 'vitest';
import { accountExportStream, serializeExportChunks } from '@/lib/recipes/account-export';

// D-04: dataset sintetico al tetto (10k ricette, 20k righe di versioni) piu' grande di 4,5 MB.
const recipe = (i: number) => ({
  id: `r${i}`,
  title: `Ricetta ${i}`,
  ingredients: Array.from({ length: 12 }, (_, k) => ({ name: `ingrediente ${k}`, quantity: k + 1, unit: 'g' })),
  steps: Array.from({ length: 8 }, (_, k) => `Passo ${k}: mescolare e cuocere a fuoco medio per qualche minuto.`),
});
const big = {
  format: 'x',
  recipes: Array.from({ length: 10000 }, (_, i) => recipe(i)),
  recipe_versions: Array.from({ length: 20000 }, (_, i) => ({ id: `v${i}`, snapshot: recipe(i) })),
  empty: [],
  nothing: undefined,
  obj: { a: 1, 'chiave "speciale"': 'è\u2028' },
};

describe('export account in streaming (D-04)', () => {
  it('i chunk concatenati sono JSON valido ed equivalente a JSON.stringify', () => {
    const joined = [...serializeExportChunks(big)].join('');
    expect(JSON.parse(joined)).toEqual(JSON.parse(JSON.stringify(big)));
  });

  it('al tetto supera 4,5 MB ma nessun singolo chunk e\' vicino al limite', () => {
    const chunks = [...serializeExportChunks(big)];
    const total = chunks.reduce((n, c) => n + Buffer.byteLength(c), 0);
    const max = Math.max(...chunks.map((c) => Buffer.byteLength(c)));
    expect(total).toBeGreaterThan(4.5 * 1024 * 1024);
    expect(max).toBeLessThan(512 * 1024);
  });

  it('lo stream emette piu\' pezzi e ricompone lo stesso JSON', async () => {
    const reader = accountExportStream({ a: Array.from({ length: 1000 }, (_, i) => i), b: 'è' }).getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    expect(parts.length).toBeGreaterThan(3);
    const text = new TextDecoder().decode(Buffer.concat(parts));
    expect(JSON.parse(text)).toEqual({ a: Array.from({ length: 1000 }, (_, i) => i), b: 'è' });
  });
});
