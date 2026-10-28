import * as cheerio from 'cheerio';

/** Pure helpers for video import (no network): URL detection, caption parsing, page metadata. */

export type VideoPlatform = 'youtube' | 'tiktok' | 'instagram';

export interface VideoRef {
  platform: VideoPlatform;
  /** Canonical URL used for the fetch and saved as the recipe source. */
  url: string;
  /** Platform video id, when it is in the URL (short links have none). */
  id: string | null;
}

const YT_ID = /^[\w-]{11}$/;

/** Recognises YouTube, YouTube Shorts, TikTok and Instagram Reels links. Returns null for anything else. */
export function detectVideoUrl(raw: string): VideoRef | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') {
    const id = parts[0];
    return id && YT_ID.test(id) ? { platform: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    let id: string | null = null;
    if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1] ?? null;
    return id && YT_ID.test(id) ? { platform: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  if (host === 'tiktok.com') {
    const vi = parts.indexOf('video');
    if (vi > 0 && parts[0].startsWith('@') && /^\d{8,25}$/.test(parts[vi + 1] ?? '')) {
      return { platform: 'tiktok', id: parts[vi + 1], url: `https://www.tiktok.com/${parts[0]}/video/${parts[vi + 1]}` };
    }
    return null;
  }
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
    return parts[0] ? { platform: 'tiktok', id: null, url: `https://${host}/${parts[0]}/` } : null;
  }
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return null;
  if (host === 'instagram.com') {
    // /reel/<code>, /reels/<code>, /p/<code>, /tv/<code>, also /<user>/reel/<code>
    const i = parts.findIndex((p) => ['reel', 'reels', 'p', 'tv'].includes(p));
    const code = i >= 0 ? parts[i + 1] : undefined;
    return code && /^[\w-]{5,20}$/.test(code) ? { platform: 'instagram', id: code, url: `https://www.instagram.com/${parts[i] === 'reels' ? 'reel' : parts[i]}/${code}/` } : null;
  }
  return null;
}

// ---------------------------------------------------------------- captions

export type CaptionFormat = 'xml' | 'json3' | 'vtt';

function safeCodePoint(cp: number, original: string): string {
  // Fuori range o surrogato: String.fromCodePoint lancerebbe RangeError (o darebbe un surrogato isolato).
  if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return original;
  return String.fromCodePoint(cp);
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (m, n) => safeCodePoint(Number(n), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => safeCodePoint(parseInt(n, 16), m))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function joinSegments(segs: string[]): string {
  // Auto captions repeat lines in rolling windows: drop consecutive duplicates.
  const out: string[] = [];
  for (const raw of segs) {
    const s = raw.replace(/\s+/g, ' ').trim();
    if (s && out[out.length - 1] !== s) out.push(s);
  }
  return out.join('\n');
}

/** Detects the caption format from the payload. */
export function sniffCaptionFormat(raw: string): CaptionFormat {
  const head = raw.trimStart().slice(0, 20);
  if (head.startsWith('WEBVTT')) return 'vtt';
  if (head.startsWith('{')) return 'json3';
  return 'xml';
}

/** Converts a caption payload (YouTube timedtext XML srv1/srv3, json3, or WebVTT) to plain text, one cue per line. */
export function captionsToText(raw: string, format: CaptionFormat = sniffCaptionFormat(raw)): string {
  if (format === 'json3') {
    let data: { events?: { segs?: { utf8?: string }[] }[] };
    try {
      data = JSON.parse(raw);
    } catch {
      return '';
    }
    return joinSegments((data.events ?? []).map((e) => (e.segs ?? []).map((s) => s.utf8 ?? '').join('')));
  }
  if (format === 'vtt') {
    const cues: string[] = [];
    for (const block of raw.replace(/\r/g, '').split(/\n{2,}/)) {
      const lines = block.split('\n');
      const ti = lines.findIndex((l) => l.includes('-->'));
      if (ti < 0) continue; // header, NOTE, STYLE
      cues.push(
        lines
          .slice(ti + 1)
          .join(' ')
          .replace(/<[^>]+>/g, ''),
      );
    }
    return joinSegments(cues.map(decodeEntities));
  }
  // xml: <text start dur>..</text> (srv1) or <p t d><s>..</s></p> (srv3)
  const cues: string[] = [];
  for (const m of raw.matchAll(/<(?:text|p)\b[^>]*>([\s\S]*?)<\/(?:text|p)>/g)) {
    // The payload is double-escaped (&amp;#39;): decode, strip inline tags, decode again.
    cues.push(decodeEntities(decodeEntities(m[1]).replace(/<[^>]+>/g, '')));
  }
  return joinSegments(cues);
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  /** 'asr' marks auto-generated captions. */
  kind?: string;
}

/** Prefers a manual track in the user's language, then an auto one in that language, then manual/auto English, then anything. */
export function pickCaptionTrack(tracks: CaptionTrack[], locale: string): CaptionTrack | null {
  if (!tracks.length) return null;
  const lang = (t: CaptionTrack) => t.languageCode.toLowerCase().split('-')[0];
  const manual = (t: CaptionTrack) => t.kind !== 'asr';
  const want = locale.toLowerCase().split('-')[0];
  return (
    tracks.find((t) => lang(t) === want && manual(t)) ??
    tracks.find((t) => lang(t) === want) ??
    tracks.find((t) => lang(t) === 'en' && manual(t)) ??
    tracks.find((t) => lang(t) === 'en') ??
    tracks.find(manual) ??
    tracks[0]
  );
}

// ---------------------------------------------------------------- page metadata

export interface VideoMeta {
  title: string;
  description: string;
  captionTracks: CaptionTrack[];
}

function balancedJson(src: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

function youtubePlayerResponse(html: string): Record<string, unknown> | null {
  const i = html.indexOf('ytInitialPlayerResponse');
  if (i < 0) return null;
  const s = html.indexOf('{', i);
  if (s < 0) return null;
  const json = balancedJson(html, s);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function clean(s: string): string {
  return s
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Title, description and caption tracks from a video page. Order of preference for the description:
 * the player response (full text on YouTube), JSON-LD VideoObject, then og:/meta description.
 */
export function extractVideoMeta(html: string): VideoMeta {
  const $ = cheerio.load(html);
  let title = '';
  let description = '';
  let captionTracks: CaptionTrack[] = [];

  const pr = youtubePlayerResponse(html) as {
    videoDetails?: { title?: string; shortDescription?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[] } };
  } | null;
  if (pr) {
    title = pr.videoDetails?.title ?? '';
    description = pr.videoDetails?.shortDescription ?? '';
    captionTracks = (pr.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [])
      .filter((t) => typeof t.baseUrl === 'string' && typeof t.languageCode === 'string')
      .map((t) => ({ baseUrl: t.baseUrl!, languageCode: t.languageCode!, kind: t.kind }));
  }

  if (!description || !title) {
    for (const el of $('script[type="application/ld+json"]').toArray()) {
      try {
        const parsed = JSON.parse($(el).contents().text());
        const nodes = Array.isArray(parsed) ? parsed : [parsed];
        const v = nodes.find((n) => n && typeof n === 'object' && String(n['@type']).includes('VideoObject'));
        if (v) {
          title ||= String(v.name ?? '');
          description ||= String(v.description ?? '');
        }
      } catch {
        /* ignore malformed JSON-LD */
      }
    }
  }
  const meta = (p: string) => $(`meta[property="${p}"], meta[name="${p}"]`).attr('content') ?? '';
  title ||= meta('og:title') || $('title').first().text();
  description ||= meta('og:description') || meta('description');

  return { title: clean(decodeEntities(title)).slice(0, 300), description: clean(decodeEntities(description)).slice(0, 10000), captionTracks };
}
