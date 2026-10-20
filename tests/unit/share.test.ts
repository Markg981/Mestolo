import { describe, expect, it } from 'vitest';
import { sharedToImportPath } from '@/lib/import/share';

describe('share target', () => {
  it('opens the link import for a shared URL', () => {
    expect(sharedToImportPath({ url: 'https://cucina.example/ragu?x=1' })).toBe('/import/link?url=https%3A%2F%2Fcucina.example%2Fragu%3Fx%3D1');
  });
  it('finds the link inside shared text (Android puts it in EXTRA_TEXT)', () => {
    expect(sharedToImportPath({ text: 'Guarda questa ricetta: https://cucina.example/pane, è buonissima!' })).toBe('/import/link?url=https%3A%2F%2Fcucina.example%2Fpane');
  });
  it('opens the text import when there is no link', () => {
    expect(sharedToImportPath({ text: 'Ingredienti\n200 g farina' })).toBe('/import/text?text=Ingredienti%0A200%20g%20farina');
  });
  it('ignores non-http schemes and empty shares', () => {
    expect(sharedToImportPath({ text: 'javascript:alert(1)' })).toBe('/import/text?text=javascript%3Aalert(1)');
    expect(sharedToImportPath({})).toBe('/import/link');
  });
});
