/**
 * Rebuilds the reading order of an OCR'd page from line geometry, because OCR engines
 * return blocks in an order that breaks typical recipe layouts:
 * - quantities in their own column ("400 g" | "calamari") are rejoined row by row;
 * - text columns (ingredients | preparation) are read one after the other, by chaining
 *   each line to the one right above it in the same column.
 * Pure, no I/O.
 */

export interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Top-left -> top-right baseline angle in radians, when the engine gives corner points. */
  angle?: number;
  /** Word boxes along the line (x and width in the line's frame), when the engine gives them. */
  words?: { text: string; x: number; w: number }[];
}

type Box = { text: string; x0: number; y0: number; x1: number; y1: number };

const UNIT = String.raw`(?:g|gr|kg|mg|ml|cl|dl|l|lt|oz|lb|pz|n\.?|cups?|tbsp|tsp|cucchia\w*|tazz\w*|bicchier\w*|spicchi?|fett\w*|q\.?\s?b\.?)`;
/** A line holding only a quantity: "400 g", "1/2", "2-3", "½ cucchiaino". */
const QTY_ONLY = new RegExp(String.raw`^(?:\d+(?:[.,/]\d+)?|[½¼¾⅓⅔])(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?\s*${UNIT}?\.?$|^${UNIT}$`, 'i');

export function linesToText(input: OcrLine[]): string {
  // specks and rules read as "|", "#", "." carry no text and would bridge columns
  const lines = input.flatMap(splitWideGaps).filter((l) => /[\p{L}\p{N}]/u.test(l.text) && l.w > 0 && l.h > 0);
  if (!lines.length) return '';
  const h = median(lines.map((l) => l.h));
  const boxes = mergeRowFragments(mergeQuantityRows(deskew(lines)), h);
  return orderBlocks(buildBlocks(boxes, h))
    .map((b) => blockText(b, h))
    .join('\n\n');
}

/**
 * The lines of a block, with a blank line where a paragraph may end: a line stopping short of the
 * block's right edge. Lines without a blank between them are certainly the same paragraph. An
 * ingredient that reaches the edge and goes on with one lowercase word wrapped ("100 g semola di
 * grano duro" + "rimacinata") and is rejoined.
 */
function blockText(b: Block, h: number): string {
  const out: string[] = [];
  b.lines.forEach((l, i) => {
    const prev = b.lines[i - 1];
    if (!prev) return void out.push(l.text);
    if (b.x1 - prev.x1 <= 0.5 * h && /^\d/.test(prev.text) && /^\p{Ll}[\p{L}'’]*$/u.test(l.text)) {
      out[out.length - 1] += ` ${l.text}`;
      return;
    }
    if (b.x1 - prev.x1 > h) out.push('');
    out.push(l.text);
  });
  return out.join('\n');
}

/**
 * Joins pieces of one row the engine split ("quindi tagliate" | "a rondelle"): two pieces side by
 * side belong to the same text line when a line right above and one right below span both.
 */
function mergeRowFragments(boxes: Box[], h: number): Box[] {
  const out = [...boxes].sort((a, b) => a.x0 - b.x0);
  const cy = (b: Box) => (b.y0 + b.y1) / 2;
  const spanned = (a: Box, b: Box, dir: number) =>
    out.some((c) => c !== a && c !== b && (cy(c) - cy(a)) * dir > 0.5 * h && (cy(c) - cy(a)) * dir <= 2 * h && overlapX(c, a) && overlapX(c, b));
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    const j = out.findIndex((b, k) => k > i && Math.abs(cy(a) - cy(b)) <= 0.5 * h && b.x0 >= a.x1 - 0.5 * h);
    if (j < 0 || !spanned(a, out[j], -1) || !spanned(a, out[j], 1)) continue;
    const b = out[j];
    out[i] = { text: `${a.text} ${b.text}`, x0: a.x0, y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
    out.splice(j, 1);
    i--; // the grown line may take the next piece too
  }
  return out;
}

/** Rotates boxes around the origin by the median line angle so rows and gutters are axis-aligned. */
function deskew(lines: OcrLine[]): Box[] {
  const angles = lines.map((l) => l.angle).filter((a): a is number => typeof a === 'number' && Math.abs(a) < 0.35);
  const a = angles.length ? -median(angles) : 0;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return lines.map((l) => {
    // Rotating the centre is enough: line boxes are small and nearly axis-aligned already.
    const cx = l.x + l.w / 2;
    const cy = l.y + l.h / 2;
    const rx = cx * cos - cy * sin;
    const ry = cx * sin + cy * cos;
    // "300 9": a g misread as 9 after a quantity
    const text = l.text.trim().replace(/^(\d+(?:[.,]\d+)?)\s+9$/, '$1 g');
    return { text, x0: rx - l.w / 2, y0: ry - l.h / 2, x1: rx + l.w / 2, y1: ry + l.h / 2 };
  });
}

/** Joins each quantity-only line with the nearest line on the same row ("400 g" + "calamari"). */
function mergeQuantityRows(boxes: Box[]): Box[] {
  const used = new Set<number>();
  const out: Box[] = [];
  boxes.forEach((q, i) => {
    if (used.has(i) || !QTY_ONLY.test(q.text)) return;
    const qh = q.y1 - q.y0;
    const qc = (q.y0 + q.y1) / 2;
    let best = -1;
    let bestGap = Infinity;
    boxes.forEach((o, j) => {
      if (j === i || used.has(j) || QTY_ONLY.test(o.text)) return;
      if (Math.abs((o.y0 + o.y1) / 2 - qc) > 0.5 * Math.max(qh, o.y1 - o.y0)) return;
      const gap = o.x0 >= q.x1 - 0.5 * qh ? o.x0 - q.x1 : q.x0 >= o.x1 - 0.5 * qh ? q.x0 - o.x1 : Infinity;
      if (gap <= 6 * qh && gap < bestGap) {
        best = j;
        bestGap = gap;
      }
    });
    if (best < 0) return;
    const o = boxes[best];
    used.add(i).add(best);
    const [l, r] = q.x0 <= o.x0 ? [q, o] : [o, q];
    out.push({ text: `${l.text} ${r.text}`, x0: Math.min(q.x0, o.x0), y0: Math.min(q.y0, o.y0), x1: Math.max(q.x1, o.x1), y1: Math.max(q.y1, o.y1) });
  });
  boxes.forEach((b, i) => {
    if (!used.has(i)) out.push(b);
  });
  return out;
}

type Block = { lines: Box[]; x0: number; y0: number; x1: number; y1: number; open: boolean };

/**
 * Reading order from local geometry. Each line is chained to the line right above it when they
 * overlap horizontally, so a column is followed even when the photo is skewed or the page curved,
 * and one stray box only breaks the chain locally (a global whitespace cut like XY-cut needs a
 * gutter that is empty along the whole page). Blocks are then sorted by orderBlocks.
 */
function buildBlocks(boxes: Box[], h: number): Block[] {
  const blocks: Block[] = [];
  const sorted = [...boxes].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1) || a.x0 - b.x0);
  for (const b of sorted) {
    const above = blocks.filter((k) => {
      const last = k.lines[k.lines.length - 1];
      return k.open && overlapX(last, b) && (b.y0 + b.y1) / 2 - (last.y0 + last.y1) / 2 > 0.5 * h;
    });
    const near = above.filter((k) => b.y0 - k.lines[k.lines.length - 1].y1 <= 1.5 * h);
    // the line covers what it overlaps: those blocks cannot continue below it
    for (const k of above) k.open = false;
    if (near.length === 1) {
      const k = near[0];
      k.lines.push(b);
      k.open = true;
      k.x0 = Math.min(k.x0, b.x0);
      k.x1 = Math.max(k.x1, b.x1);
      k.y1 = Math.max(k.y1, b.y1);
    } else blocks.push({ lines: [b], x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, open: true });
  }
  return blocks;
}

/**
 * Topological sort of blocks (Breuel's reading-order rules): a block precedes the blocks below it
 * in its column, and the blocks of a column to its right unless a wider block lies between them
 * (columns, then a full-width paragraph, then more columns). Ties and cycles fall back to
 * top-to-bottom, left-to-right.
 */
function orderBlocks(blocks: Block[]): Block[] {
  const separated = (a: Block, b: Block) =>
    blocks.some((c) => c !== a && c !== b && c.y0 > Math.min(a.y0, b.y0) && c.y0 < Math.max(a.y0, b.y0) && overlapX(c, a) && overlapX(c, b));
  const before = (a: Block, b: Block) => (overlapX(a, b) ? a.y0 < b.y0 : a.x0 < b.x0 && !separated(a, b));
  const rest = [...blocks].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const out: Block[] = [];
  while (rest.length) {
    const i = Math.max(0, rest.findIndex((b) => !rest.some((a) => a !== b && before(a, b))));
    out.push(...rest.splice(i, 1));
  }
  return out;
}

/** Two boxes share a column when they overlap by at least 30% of the narrower one. */
function overlapX(a: { x0: number; x1: number }, b: { x0: number; x1: number }): boolean {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) >= 0.3 * Math.min(a.x1 - a.x0, b.x1 - b.x0);
}

/**
 * Splits a line where two words are far apart: OCR engines sometimes join the rows of two
 * columns into one line ("100 g semola     Nel frattempo, ...").
 */
function splitWideGaps(l: OcrLine): OcrLine[] {
  const words = l.words?.filter((w) => w.text.trim());
  if (!words || words.length < 2) return [l];
  const out: OcrLine[] = [];
  let start = 0;
  for (let i = 1; i <= words.length; i++) {
    if (i < words.length && words[i].x - (words[i - 1].x + words[i - 1].w) <= 1.5 * l.h) continue;
    const part = words.slice(start, i);
    const x0 = part[0].x;
    const x1 = part[part.length - 1].x + part[part.length - 1].w;
    out.push({ text: part.map((w) => w.text).join(' '), x: x0, y: l.y, w: x1 - x0, h: l.h, angle: l.angle });
    start = i;
  }
  return out.length > 1 ? out : [l];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
