/**
 * Slug of a public recipe page: normalized title + first 8 hex chars of the id.
 * Mirror of public.make_recipe_slug (migration 20261025000001; dal 20261104000001 il database usa un suffisso casuale, non l'id): the database is the
 * source of truth and assigns the slug once; this copy validates and is tested against
 * the same vectors.
 */
const ACCENTS_FROM = 'àáâãäåèéêëìíîïòóôõöùúûüýÿñç';
const ACCENTS_TO = 'aaaaaaeeeeiiiiooooouuuuyync';

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 120 && SLUG_RE.test(s);
}

export function makeRecipeSlug(title: string, id: string): string {
  let base = (title ?? '').toLowerCase().replaceAll('ß', 'ss');
  base = [...base]
    .map((ch) => {
      const i = ACCENTS_FROM.indexOf(ch);
      return i >= 0 ? ACCENTS_TO[i] : ch;
    })
    .join('');
  base = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  base = base.slice(0, 60).replace(/^-+|-+$/g, '');
  if (!base) base = 'ricetta';
  return `${base}-${id.replaceAll('-', '').slice(0, 8)}`;
}
