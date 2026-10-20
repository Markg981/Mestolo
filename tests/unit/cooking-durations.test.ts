import { describe, expect, it } from 'vitest';
import { detectDurations, formatClock } from '@/lib/cooking/durations';

const secs = (t: string) => detectDurations(t).map((d) => d.seconds);

describe('detectDurations', () => {
  it('italian', () => {
    expect(secs('Cuoci 10 minuti a fuoco basso')).toEqual([600]);
    expect(secs('Lascia riposare per 1 ora e mezza')).toEqual([5400]);
    expect(secs('Cuoci 1 ora e 30 minuti')).toEqual([5400]);
    expect(secs("Inforna per un'ora")).toEqual([3600]);
    expect(secs("Riposo di mezz'ora")).toEqual([1800]);
    expect(secs('Scotta 30 secondi per lato')).toEqual([30]);
  });
  it('ranges use the lower bound', () => {
    expect(secs('Soffriggi 2-3 min')).toEqual([120]);
    expect(secs('Cuoci 10 a 15 minuti')).toEqual([600]);
  });
  it('other locales', () => {
    expect(secs('Bake for 1 hour and a half')).toEqual([5400]);
    expect(secs('Simmer 15 minutes')).toEqual([900]);
    expect(secs('Cocer 20 minutos')).toEqual([1200]);
    expect(secs('Laisser mijoter 45 minutes')).toEqual([2700]);
    expect(secs('2 Stunden ruhen lassen')).toEqual([7200]);
    expect(secs('Cozinhe 1,5 horas')).toEqual([5400]);
    expect(secs('Cozinhe 40 segundos')).toEqual([40]);
    expect(secs('Kochen 5 Sekunden')).toEqual([5]);
  });
  it('compact forms and multiple matches with positions', () => {
    expect(secs('Cuoci 1h30')).toEqual([5400]);
    const d = detectDurations('Cuoci 10 min poi riposa 5 min');
    expect(d.map((x) => x.seconds)).toEqual([600, 300]);
    expect(d[0].label).toBe('10 min');
  });
  it('ignores non durations', () => {
    expect(secs('Aggiungi 200 g di farina')).toEqual([]);
    expect(secs('Forno a 180 gradi')).toEqual([]);
    expect(secs('Mescola con attenzione')).toEqual([]);
    expect(secs('Taglia a 5 mm')).toEqual([]);
  });
});

describe('formatClock', () => {
  it('formats', () => {
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(607)).toBe('10:07');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(-3)).toBe('0:00');
  });
});
