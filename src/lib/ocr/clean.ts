/**
 * Cleans raw OCR output before it goes to the heuristic recipe parser:
 * joins words hyphenated across lines, normalizes bullets, fixes O/0 in quantities,
 * strips noise-only lines and collapses whitespace. Pure, no I/O.
 */
export function cleanOcrText(raw: string): string {
  let t = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ');
  // Bullet glyphs at line start become a plain dash
  t = t.replace(/^ *[•·▪●○■□◦»›] */gm, '- ');
  // "I|" -> "Il": a pipe next to a letter is an l
  t = t.replace(/(?<=\p{L})\||\|(?=\p{Ll})/gu, 'l');
  t = t.replace(/\p{L}+/gu, fixMixedCase);
  // "pomo-\ndori" -> "pomodori" (after the case fixes, for "asciU-\ngare"); "la-\nSciate": a
  // same-shape capital after a hyphen is a misread
  t = t.replace(/([a-zàèéìòù])-\n(?:([a-zàèéìòù])|([COSUVWXZ])(?=[a-zàèéìòù]))/g, (_, a: string, b?: string, c?: string) => a + (b ?? c!.toLowerCase()));
  // "300 9 mazzancolle": a g misread as 9 after a quantity
  t = t.replace(/^(\d+(?:[.,]\d+)?) 9 (?=\p{L})/gmu, '$1 g ');
  // O/o between digits or before a unit is a misread zero
  t = t.replace(/(?<=\d)[Oo](?=\d|\s*(?:g|kg|ml|l|cl|dl)\b)/g, '0');
  t = t
    .split('\n')
    .map((l) => l.replace(/ {2,}/g, ' ').trim())
    .filter((l) => l === '' || /[\p{L}\p{N}]/u.test(l))
    .join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/** Letters whose upper and lower case look the same: OCR often picks the wrong case. */
const SAME_SHAPE = /^[COSUVWXZ]$/;

/**
 * Fixes OCR case errors inside a word: "ZUCchine" -> "zucchine", "qUadrati" -> "quadrati",
 * "GIi" -> "Gli" (I read for l). All-caps and normally capitalized words are left alone.
 */
function fixMixedCase(w: string): string {
  const rest = w.slice(1);
  if (!/\p{Ll}/u.test(w) || !/\p{Lu}/u.test(rest)) return w;
  const body = rest.replace(/I(?=\p{Ll})|(?<=\p{Ll})I/gu, 'l').toLowerCase();
  // "ZUcchine", "SCorza": the first letter was misread along with the next one
  const first = SAME_SHAPE.test(w[0]) && /^\p{Lu}/u.test(rest) ? w[0].toLowerCase() : w[0];
  return first + body;
}

/** Joins the text of several pages (kept in the order chosen by the user). */
export function joinPages(pages: string[]): string {
  return pages.map(cleanOcrText).filter(Boolean).join('\n\n');
}
