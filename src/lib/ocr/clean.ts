/**
 * Cleans raw OCR output before it goes to the heuristic recipe parser:
 * joins words hyphenated across lines, normalizes bullets, fixes O/0 in quantities,
 * strips noise-only lines and collapses whitespace. Pure, no I/O.
 */
export function cleanOcrText(raw: string): string {
  let t = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ');
  // "pomo-\ndori" -> "pomodori"
  t = t.replace(/([a-zàèéìòù])-\n([a-zàèéìòù])/g, '$1$2');
  // Bullet glyphs at line start become a plain dash
  t = t.replace(/^ *[•·▪●○■□◦»›] */gm, '- ');
  // O/o between digits or before a unit is a misread zero
  t = t.replace(/(?<=\d)[Oo](?=\d|\s*(?:g|kg|ml|l|cl|dl)\b)/g, '0');
  t = t
    .split('\n')
    .map((l) => l.replace(/ {2,}/g, ' ').trim())
    .filter((l) => l === '' || /[\p{L}\p{N}]/u.test(l))
    .join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/** Joins the text of several pages (kept in the order chosen by the user). */
export function joinPages(pages: string[]): string {
  return pages.map(cleanOcrText).filter(Boolean).join('\n\n');
}
