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
  it('corregge ml/dl/cl letti come mi/di/ci dopo una quantità (OCR reale)', () => {
    expect(cleanOcrText('100 mi di latte')).toBe('100 ml di latte');
    expect(cleanOcrText('1,5 di di latte')).toBe('1,5 dl di latte');
    expect(cleanOcrText("2 ci d'olio")).toBe("2 cl d'olio");
    // senza connettore "di" può essere prosa: non si tocca
    expect(cleanOcrText('2 di loro')).toBe('2 di loro');
    expect(cleanOcrText('Poi mi raccomando')).toBe('Poi mi raccomando');
  });
  it('rimuove righe di solo rumore e comprime gli spazi', () => {
    expect(cleanOcrText('uova   due\n---\n\n\n\nmescola')).toBe('uova due\n\nmescola');
  });
  it('corregge le maiuscole spurie in mezzo alla parola', () => {
    expect(cleanOcrText('poMOdoro saLe ZUCchine qUadrati')).toBe('pomodoro sale zucchine quadrati');
  });
  it('preserva le maiuscole miste legittime (M12)', () => {
    expect(cleanOcrText('McDonald iPhone MacBook eBay')).toBe('McDonald iPhone MacBook eBay');
    expect(cleanOcrText('IGP DOP Mestolo')).toBe('IGP DOP Mestolo');
  });
  it('unisce più pagine saltando le vuote', () => {
    expect(joinPages(['a b', '  ', 'c d'])).toBe('a b\n\nc d');
  });
});
