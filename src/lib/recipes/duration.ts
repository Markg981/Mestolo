/** ISO-8601 duration (PT1H30M, P1DT2H, PT90M) to minutes. Returns null if invalid or zero-length. */
export function parseIsoDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m || value.trim().toUpperCase() === 'P' || value.trim().toUpperCase() === 'PT') return null;
  const [, d, h, min, s] = m;
  const total = (Number(d ?? 0) * 24 + Number(h ?? 0)) * 60 + Number(min ?? 0) + Number(s ?? 0) / 60;
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round(total);
}

const HOUR_WORDS = '(?:h|hr|hrs|hour|hours|ora|ore|hora|horas|heure|heures|std|stunde|stunden)';
const MIN_WORDS = "(?:m|min|mins|minute|minutes|minuto|minuti|minutos|minuten|')";

/**
 * Parses human durations in the supported languages:
 * "1 ora e 30 minuti", "45 min", "1h20", "1 hour 15 minutes", "1,5 ore".
 */
export function parseHumanDuration(text: string): number | null {
  const t = text.toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
  let minutes = 0;
  let matched = false;
  const hourRe = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${HOUR_WORDS}(?![a-zà-ü])`, 'g');
  const minRe = new RegExp(`(\\d+)\\s*${MIN_WORDS}(?![a-zà-ü])`, 'g');
  let lastHourEnd = -1;
  for (const m of t.matchAll(hourRe)) {
    minutes += Number(m[1]) * 60;
    matched = true;
    lastHourEnd = (m.index ?? 0) + m[0].length;
  }
  for (const m of t.matchAll(minRe)) {
    minutes += Number(m[1]);
    matched = true;
  }
  // "1h20" → bare number right after the hour unit counts as minutes
  if (lastHourEnd >= 0 && !minRe.test(t)) {
    const bare = t.slice(lastHourEnd).match(/^\s*(\d{1,2})(?!\d)/);
    if (bare) minutes += Number(bare[1]);
  }
  if (!matched) return null;
  return minutes > 0 ? Math.round(minutes) : null;
}

export function formatMinutes(min: number | null | undefined, labels: { h: string; min: string }): string {
  if (min === null || min === undefined) return '';
  if (min < 60) return `${min} ${labels.min}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ${labels.h} ${m} ${labels.min}` : `${h} ${labels.h}`;
}
