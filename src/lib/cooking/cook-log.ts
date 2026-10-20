/** Validation helpers for "L'ho cucinata" (cook logs). Pure, shared by the server action and the form. */

export const COOK_NOTE_MAX = 1000;
export const COOK_VISIBILITIES = ['private', 'recipe'] as const;
export type CookVisibility = (typeof COOK_VISIBILITIES)[number];
/** Oldest allowed backdating, in days (about 5 years). */
export const COOK_MAX_PAST_DAYS = 5 * 365;

export function isCookVisibility(v: unknown): v is CookVisibility {
  return typeof v === 'string' && (COOK_VISIBILITIES as readonly string[]).includes(v);
}

/** Trims, normalises line breaks and strips control characters; null when the note is too long. */
export function normalizeCookNote(raw: unknown): string | null {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') return null;
  const clean = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return clean.length > COOK_NOTE_MAX ? null : clean;
}

/**
 * Parses a YYYY-MM-DD day (the value of <input type="date">) into an ISO timestamp at noon UTC,
 * so the calendar day is the same in every timezone. Rejects invalid dates, dates more than 1.5
 * day in the future (timezone slack) and dates older than COOK_MAX_PAST_DAYS. Empty input = now.
 */
export function parseCookDate(raw: unknown, now: Date = new Date()): string | null {
  if (raw === null || raw === undefined || raw === '') return now.toISOString();
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  const diffDays = (date.getTime() - now.getTime()) / 86_400_000;
  if (diffDays > 1.5 || diffDays < -COOK_MAX_PAST_DAYS) return null;
  // a day in the future by timezone slack is clamped to now
  return date.getTime() > now.getTime() ? now.toISOString() : date.toISOString();
}

export interface CookLogInput {
  recipeId: string;
  note: string;
  cookedAt: string;
  visibility: CookVisibility;
}

/** Validates the text fields of the create form; null when anything is invalid. */
export function parseCookLogInput(fields: { recipeId?: unknown; note?: unknown; date?: unknown; visibility?: unknown }, now?: Date): CookLogInput | null {
  const recipeId = typeof fields.recipeId === 'string' ? fields.recipeId : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipeId)) return null;
  const note = normalizeCookNote(fields.note);
  const cookedAt = parseCookDate(fields.date, now);
  const visibility = fields.visibility === undefined || fields.visibility === '' ? 'recipe' : fields.visibility;
  if (note === null || cookedAt === null || !isCookVisibility(visibility)) return null;
  return { recipeId, note, cookedAt, visibility };
}

/** Storage path of a log photo: <user>/cook/<uuid>.webp (matches the DB check constraint). */
export function cookPhotoPath(userId: string, name: string): string {
  return `${userId}/cook/${name}.webp`;
}
