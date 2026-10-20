/** Pure helpers of the cooking mode: step navigation, swipe, voice commands, timers. */

export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(total - 1, Math.max(0, Math.trunc(index)));
}

export function nextStep(index: number, total: number): number {
  return clampStep(index + 1, total);
}

export function prevStep(index: number, total: number): number {
  return clampStep(index - 1, total);
}

/** 0..1 completion where the last step counts as 100%. */
export function stepProgress(index: number, total: number): number {
  if (total <= 1) return total === 1 ? 1 : 0;
  return clampStep(index, total) / (total - 1);
}

export type NavDirection = 'next' | 'prev';

/** Swipe left = next, swipe right = back. Ignores short or mostly vertical gestures (scrolling). */
export function swipeDirection(dx: number, dy: number, minDistance = 60): NavDirection | null {
  if (Math.abs(dx) < minDistance || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'next' : 'prev';
}

export function keyDirection(key: string): NavDirection | null {
  if (key === 'ArrowRight' || key === 'PageDown') return 'next';
  if (key === 'ArrowLeft' || key === 'PageUp') return 'prev';
  return null;
}

const VOICE: Record<string, { next: string[]; prev: string[] }> = {
  it: { next: ['avanti', 'prossimo', 'successivo'], prev: ['indietro', 'precedente'] },
  en: { next: ['next', 'forward'], prev: ['back', 'previous'] },
  es: { next: ['siguiente', 'adelante'], prev: ['atras', 'anterior'] },
  fr: { next: ['suivant', 'suivante', 'avance'], prev: ['precedent', 'precedente', 'retour', 'arriere'] },
  de: { next: ['weiter', 'nachster', 'vor'], prev: ['zuruck', 'vorherige', 'vorheriger'] },
  pt: { next: ['proximo', 'avancar', 'seguinte'], prev: ['voltar', 'anterior', 'atras'] },
};

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');

/** Maps a recognised phrase to a command; the last command word in the phrase wins. */
export function matchVoiceCommand(transcript: string, locale: string): NavDirection | null {
  const words = VOICE[locale.slice(0, 2)] ?? VOICE.en;
  let found: NavDirection | null = null;
  for (const w of strip(transcript).split(/[^a-z]+/)) {
    if (!w) continue;
    if (words.next.includes(w)) found = 'next';
    else if (words.prev.includes(w)) found = 'prev';
  }
  return found;
}

export function remainingSeconds(endAt: number, now: number): number {
  return Math.max(0, Math.ceil((endAt - now) / 1000));
}

/** Parses the persisted per-recipe state defensively. */
export function parseCookState(raw: string | null, ingredientCount: number, stepCount: number): { step: number; checked: number[] } {
  const empty = { step: 0, checked: [] as number[] };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as { step?: unknown; checked?: unknown };
    const checked = Array.isArray(v.checked) ? [...new Set(v.checked.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < ingredientCount))] : [];
    return { step: typeof v.step === 'number' ? clampStep(v.step, stepCount) : 0, checked };
  } catch {
    return empty;
  }
}
