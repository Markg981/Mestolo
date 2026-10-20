/** Turns shared content (url / text / title) into the right import page. */
export function sharedToImportPath(input: { url?: string | null; text?: string | null; title?: string | null }): string {
  const candidates = [input.url, input.text, input.title].filter((x): x is string => typeof x === 'string' && x.length > 0);
  for (const c of candidates) {
    const m = c.match(/https?:\/\/[^\s<>"']+/i);
    if (m) {
      const url = m[0].replace(/[),.;!?]+$/, '');
      if (url.length <= 2000) return `/import/link?url=${encodeURIComponent(url)}`;
    }
  }
  const text = (input.text ?? input.title ?? '').slice(0, 8000);
  return text.trim() ? `/import/text?text=${encodeURIComponent(text)}` : '/import/link';
}
