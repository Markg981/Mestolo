import { z } from 'zod';

export const PROFILE_VISIBILITIES = ['public', 'friends', 'private'] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

export const BIO_MAX = 280;
export const LOCATION_MAX = 80;
export const WEBSITE_MAX = 200;
export const CUISINES_MAX = 8;
export const CUISINE_MAX_LEN = 30;
// Limiti sull'input grezzo (prima di normalizzazione e deduplica).
export const CUISINES_INPUT_MAX = 50;
export const CUISINE_INPUT_MAX = 100;

/** Empty string means "no website" (null). Only https links, no credentials, no spaces; undefined = invalid. */
export function normalizeWebsite(input: string): string | null | undefined {
  const raw = input.trim();
  if (!raw) return null;
  if (raw.length > WEBSITE_MAX || /\s/.test(raw)) return undefined;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return undefined;
  const out = url.toString();
  return out.length <= WEBSITE_MAX ? out : undefined;
}

/** "Italiana, giapponese" -> unique lower-case tags. */
export function parseCuisines(input: string | string[]): string[] {
  const list = Array.isArray(input) ? input : input.split(',');
  const seen = new Set<string>();
  for (const c of list) {
    const v = c.trim().toLowerCase().replace(/\s+/g, ' ');
    if (v) seen.add(v);
  }
  return [...seen];
}

export const richProfileSchema = z.object({
  bio: z.string().trim().max(BIO_MAX),
  location: z.string().trim().max(LOCATION_MAX),
  website: z.string().transform((v, ctx) => {
    const n = normalizeWebsite(v);
    if (n === undefined) ctx.addIssue({ code: 'custom', message: 'website' });
    return n ?? null;
  }),
  favorite_cuisines: z
    .array(z.string().max(CUISINE_INPUT_MAX))
    .max(CUISINES_INPUT_MAX)
    .transform(parseCuisines)
    .pipe(z.array(z.string().min(1).max(CUISINE_MAX_LEN)).max(CUISINES_MAX)),
  profile_visibility: z.enum(PROFILE_VISIBILITIES),
});
