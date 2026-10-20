import { describe, expect, it } from 'vitest';
import { clampStep, keyDirection, matchVoiceCommand, nextStep, parseCookState, prevStep, remainingSeconds, stepProgress, swipeDirection } from '@/lib/cooking/navigation';

describe('step navigation', () => {
  it('clamps', () => {
    expect(nextStep(2, 3)).toBe(2);
    expect(prevStep(0, 3)).toBe(0);
    expect(nextStep(0, 3)).toBe(1);
    expect(clampStep(9, 0)).toBe(0);
    expect(clampStep(NaN, 4)).toBe(0);
  });
  it('progress', () => {
    expect(stepProgress(0, 5)).toBe(0);
    expect(stepProgress(4, 5)).toBe(1);
    expect(stepProgress(0, 1)).toBe(1);
    expect(stepProgress(0, 0)).toBe(0);
  });
  it('swipe and keys', () => {
    expect(swipeDirection(-100, 10)).toBe('next');
    expect(swipeDirection(100, 10)).toBe('prev');
    expect(swipeDirection(-100, 90)).toBeNull();
    expect(swipeDirection(-20, 0)).toBeNull();
    expect(keyDirection('ArrowRight')).toBe('next');
    expect(keyDirection('ArrowLeft')).toBe('prev');
    expect(keyDirection('a')).toBeNull();
  });
});

describe('voice commands', () => {
  it('per locale, accent-insensitive', () => {
    expect(matchVoiceCommand('Avanti', 'it')).toBe('next');
    expect(matchVoiceCommand('indietro per favore', 'it')).toBe('prev');
    expect(matchVoiceCommand('next step', 'en')).toBe('next');
    expect(matchVoiceCommand('atrás', 'es')).toBe('prev');
    expect(matchVoiceCommand('précédent', 'fr')).toBe('prev');
    expect(matchVoiceCommand('zurück', 'de')).toBe('prev');
    expect(matchVoiceCommand('próximo', 'pt')).toBe('next');
    expect(matchVoiceCommand('blablabla', 'it')).toBeNull();
    expect(matchVoiceCommand('', 'it')).toBeNull();
  });
});

describe('timers and state', () => {
  it('remaining', () => {
    expect(remainingSeconds(10_000, 9_001)).toBe(1);
    expect(remainingSeconds(10_000, 20_000)).toBe(0);
  });
  it('parses stored state defensively', () => {
    expect(parseCookState(null, 3, 3)).toEqual({ step: 0, checked: [] });
    expect(parseCookState('{bad', 3, 3)).toEqual({ step: 0, checked: [] });
    expect(parseCookState('{"step":9,"checked":[0,0,2,7,"x"]}', 3, 3)).toEqual({ step: 2, checked: [0, 2] });
  });
});
