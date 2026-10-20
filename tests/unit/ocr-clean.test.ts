import { describe, expect, it } from 'vitest';
import { cleanOcrText, joinPages } from '@/lib/ocr/clean';

describe('cleanOcrText', () => {
  it('unisce le parole spezzate a fine riga', () => {
    expect(cleanOcrText('pomo-\ndori maturi')).toBe('pomodori maturi');
  });
  it('normalizza i punti elenco', () => {
    expect(cleanOcrText('• farina\n● uova')).toBe('- farina\n- uova');
  });
  it('corregge O al posto di 0 nelle quantità', () => {
    expect(cleanOcrText('2O0 g farina')).toBe('200 g farina');
  });
  it('rimuove righe di solo rumore e comprime gli spazi', () => {
    expect(cleanOcrText('uova   due\n---\n\n\n\nmescola')).toBe('uova due\n\nmescola');
  });
  it('unisce più pagine saltando le vuote', () => {
    expect(joinPages(['a b', '  ', 'c d'])).toBe('a b\n\nc d');
  });
});
