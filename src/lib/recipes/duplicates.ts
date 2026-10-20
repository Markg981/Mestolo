/**
 * Possible-duplicate detection within a user's own recipe book.
 * Signals: identical source URL, very similar title, or similar title plus
 * overlapping ingredients. The user decides what to do (nothing is merged automatically).
 */

const STOPWORDS = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'uno', 'di', 'del', 'della', 'dei', 'delle', 'al', 'alla', 'alle', 'ai', 'con', 'e', 'ed', 'in', 'per', 'da',
  'the', 'a', 'an', 'of', 'with', 'and', 'in', 'for', 'el', 'los', 'las', 'de', 'con', 'y', 'le', 'les', 'des', 'du', 'au', 'aux', 'et', 'avec',
  'der', 'die', 'das', 'mit', 'und', 'o', 'os', 'as', 'do', 'da', 'com', 'ricetta', 'recipe', 'receta', 'recette', 'rezept', 'receita', 'facile', 'easy',
]);

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleTokens(title: string): string[] {
  return normalizeText(title)
    .split(' ')
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, '');
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice coefficient on character bigrams of the meaningful title tokens. */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a).sort().join(' ');
  const tb = titleTokens(b).sort().join(' ');
  if (!ta || !tb) return 0;
  if (ta === tb) return 1;
  const ba = bigrams(ta);
  const bb = bigrams(tb);
  if (!ba.length || !bb.length) return 0;
  const counts = new Map<string, number>();
  for (const g of ba) counts.set(g, (counts.get(g) ?? 0) + 1);
  let inter = 0;
  for (const g of bb) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      inter++;
      counts.set(g, c - 1);
    }
  }
  return (2 * inter) / (ba.length + bb.length);
}

export function ingredientOverlap(a: string[], b: string[]): number {
  const na = new Set(a.map(normalizeText).filter(Boolean));
  const nb = new Set(b.map(normalizeText).filter(Boolean));
  if (!na.size || !nb.size) return 0;
  let inter = 0;
  for (const x of na) if (nb.has(x)) inter++;
  return inter / (na.size + nb.size - inter);
}

export function normalizeSourceUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.search);
    for (const k of [...params.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|mc_)/i.test(k)) params.delete(k);
    }
    const q = params.toString();
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${q ? `?${q}` : ''}`.toLowerCase();
  } catch {
    return null;
  }
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  source_url?: string | null;
  ingredientNames: string[];
}

export interface DuplicateMatch {
  id: string;
  title: string;
  score: number;
  reason: 'same_source' | 'similar_title' | 'similar_content';
}

export function findPossibleDuplicates(
  draft: { title: string; source_url?: string | null; ingredientNames: string[] },
  existing: DuplicateCandidate[],
  excludeId?: string,
): DuplicateMatch[] {
  const draftUrl = normalizeSourceUrl(draft.source_url);
  const matches: DuplicateMatch[] = [];
  for (const r of existing) {
    if (r.id === excludeId) continue;
    if (draftUrl && normalizeSourceUrl(r.source_url) === draftUrl) {
      matches.push({ id: r.id, title: r.title, score: 1, reason: 'same_source' });
      continue;
    }
    const ts = titleSimilarity(draft.title, r.title);
    if (ts >= 0.88) {
      matches.push({ id: r.id, title: r.title, score: ts, reason: 'similar_title' });
      continue;
    }
    if (ts >= 0.55) {
      const io = ingredientOverlap(draft.ingredientNames, r.ingredientNames);
      if (io >= 0.6) matches.push({ id: r.id, title: r.title, score: (ts + io) / 2, reason: 'similar_content' });
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}
