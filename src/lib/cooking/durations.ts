/**
 * Detects cooking durations in free step text, in the 6 supported languages (it, en, es, fr, de, pt).
 * Pure and dependency-free. Ranges ("2-3 min") use the lower bound, so the timer rings when checking is due.
 */
export interface DetectedDuration {
  /** timer length in seconds */
  seconds: number;
  /** the matched text, shown on the timer chip */
  label: string;
  start: number;
  end: number;
}

const HOUR = '(?:h|hr|hrs|hour|hours|ora|ore|hora|horas|heure|heures|stunde|stunden|std)';
const MIN = '(?:min|mins|minute|minutes|minuto|minuti|minutos|minuten|mn)';
const SEC = '(?:sec|secs|second|seconds|secondo|secondi|segundo|segundos|seconde|secondes|sekunde|sekunden)';
const NUM = '\\d+(?:[.,]\\d+)?';
const RANGE = '(?:-|–|—|a|to|à|bis|al)';
const HALF = '(?:mezza|mezzo|half|media|medio|demie|demi|halbe|halben|meia|meio|1/2|½)';
const AND = '(?:e|and|y|et|und)';
const BEFORE = '(?<![\\p{L}\\d])';
const AFTER = '(?![\\p{L}])';

const num = (s: string) => Number(s.replace(',', '.'));

function rangeSeconds(a: string, b: string | undefined, unitSeconds: number) {
  const lo = num(a);
  const hi = b ? num(b) : lo;
  return Math.round(Math.min(lo, hi) * unitSeconds);
}

function collect(text: string): DetectedDuration[] {
  const lower = text.toLowerCase();
  const out: DetectedDuration[] = [];
  const push = (m: RegExpMatchArray, seconds: number) => {
    if (seconds <= 0 || !Number.isFinite(seconds)) return;
    const start = m.index ?? 0;
    out.push({ seconds, label: text.slice(start, start + m[0].length).trim(), start, end: start + m[0].length });
  };

  // "mezz'ora", "half an hour", "meia hora", "eine halbe Stunde"
  for (const m of lower.matchAll(new RegExp(`${BEFORE}(?:mezz['’]ora|mezza ora|half an hour|media hora|une demi-heure|demi-heure|eine halbe stunde|halbe stunde|meia hora)${AFTER}`, 'gu'))) push(m, 1800);
  // "un'ora", "an hour", "una hora", "une heure", "eine Stunde", "uma hora"
  for (const m of lower.matchAll(new RegExp(`${BEFORE}(?:un['’]ora|un ora|an hour|one hour|una hora|une heure|eine stunde|uma hora)${AFTER}`, 'gu'))) push(m, 3600);
  for (const m of lower.matchAll(new RegExp(`${BEFORE}(?:un minuto|a minute|one minute|une minute|eine minute|um minuto)${AFTER}`, 'gu'))) push(m, 60);

  // hours, optionally followed by "e mezza" / "e 30 minuti" / "30" (as in 1h30)
  const hourRe = new RegExp(
    `${BEFORE}(${NUM})(?:\\s*${RANGE}\\s*(${NUM}))?\\s*${HOUR}${AFTER}(?:(\\s*${AND}\\s*(?:a\\s+)?${HALF}${AFTER})|\\s*(?:${AND}\\s*)?(\\d{1,2})\\s*${MIN}${AFTER}|(\\d{2})(?!\\d))?`,
    'gu',
  );
  for (const m of lower.matchAll(hourRe)) {
    let s = rangeSeconds(m[1], m[2], 3600);
    if (m[3]) s += 1800;
    else if (m[4]) s += Number(m[4]) * 60;
    else if (m[5]) s += Number(m[5]) * 60;
    push(m, s);
  }

  for (const m of lower.matchAll(new RegExp(`${BEFORE}(${NUM})(?:\\s*${RANGE}\\s*(${NUM}))?\\s*${MIN}${AFTER}`, 'gu'))) push(m, rangeSeconds(m[1], m[2], 60));
  for (const m of lower.matchAll(new RegExp(`${BEFORE}(${NUM})(?:\\s*${RANGE}\\s*(${NUM}))?\\s*${SEC}${AFTER}`, 'gu'))) push(m, rangeSeconds(m[1], m[2], 1));
  return out;
}

export function detectDurations(text: string): DetectedDuration[] {
  const sorted = collect(text).sort((a, b) => a.start - b.start || b.end - a.end);
  const result: DetectedDuration[] = [];
  for (const c of sorted) {
    const last = result[result.length - 1];
    if (last && c.start < last.end) continue; // overlapping: keep the earlier/longer match
    result.push(c);
  }
  return result;
}

/** 5:07, 1:02:03 */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
