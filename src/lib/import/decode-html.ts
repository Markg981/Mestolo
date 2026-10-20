const UTF8 = 'utf-8';

/** Returns a canonical label if TextDecoder knows it, otherwise null (never throws). */
function validLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const clean = label.trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (!clean) return null;
  try {
    return new TextDecoder(clean).encoding;
  } catch {
    return null;
  }
}

function charsetFromContentType(contentType: string | undefined): string | null {
  const m = /charset\s*=\s*("[^"]*"|'[^']*'|[^\s;]+)/i.exec(contentType ?? '');
  return m ? validLabel(m[1]) : null;
}

function charsetFromBom(body: Uint8Array): string | null {
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return UTF8;
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) return 'utf-16le';
  if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) return 'utf-16be';
  return null;
}

function charsetFromMeta(body: Uint8Array): string | null {
  // Meta declarations are ASCII-compatible, so latin1 is a safe lossless view of the head.
  const head = new TextDecoder('latin1').decode(body.subarray(0, 4096));
  const direct = /<meta\s[^>]*?charset\s*=\s*["']?\s*([^"'\s/>;]+)/i.exec(head);
  if (direct) {
    const l = validLabel(direct[1]);
    if (l) return l;
  }
  const tags = head.match(/<meta\s[^>]*http-equiv\s*=\s*["']?content-type["']?[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const l = charsetFromContentType(/content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]);
    if (l) return l;
  }
  return null;
}

// Some Node builds decode windows-1252 as plain latin1, leaving 0x80-0x9F as C1 controls.
const CP1252_C1 = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function fixCp1252(text: string): string {
  return text.replace(/[-]/g, (c) => CP1252_C1[c.charCodeAt(0) - 0x80]);
}

/**
 * Decodes an HTML response body: Content-Type charset, then BOM, then <meta>
 * in the first KB, then utf-8. Unknown labels are ignored instead of throwing.
 */
export function decodeHtml(body: Uint8Array, contentType?: string): string {
  const encoding = charsetFromContentType(contentType) ?? charsetFromBom(body) ?? charsetFromMeta(body) ?? UTF8;
  const text = new TextDecoder(encoding).decode(body);
  return encoding === 'windows-1252' ? fixCp1252(text) : text;
}
