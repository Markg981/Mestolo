import 'server-only';
import { safeFetch, FetchFailedError, type SafeFetchResult } from './safe-fetch';
import { decodeHtml } from './decode-html';
import { captionsToText, detectVideoUrl, extractVideoMeta, pickCaptionTrack, type VideoPlatform } from './video';
import { parseRecipeText } from '@/lib/recipes/text-parser';

/** Where the text of a video import came from. 'none' = the page offered nothing usable. */
export type VideoTextSource = 'description' | 'captions' | 'none';

export interface VideoTextResult {
  platform: VideoPlatform;
  source: VideoTextSource;
  title: string;
  /** Editable text to feed to the text parser (title + description and/or captions). */
  text: string;
  sourceUrl: string;
  captionLang: string | null;
}

export const MAX_VIDEO_TEXT = 20000;

// EU consent interstitials would otherwise replace the YouTube page.
const YT_HEADERS = { cookie: 'SOCS=CAI; CONSENT=YES+1' };

/** A description is "enough" when the heuristic parser finds a recipe skeleton in it. */
export function descriptionLooksLikeRecipe(description: string): boolean {
  if (description.length < 80) return false;
  const p = parseRecipeText(description);
  return p.ingredients.length >= 2 && p.steps.length >= 1;
}

function isYoutubeCaptionUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && /(^|\.)youtube\.com$/.test(u.hostname) && u.pathname.startsWith('/api/timedtext');
  } catch {
    return false;
  }
}

async function fetchCaptions(baseUrl: string): Promise<string> {
  if (!isYoutubeCaptionUrl(baseUrl)) return '';
  const u = new URL(baseUrl);
  u.searchParams.delete('fmt'); // default srv1 XML is the most stable; json3/vtt are parsed too if served
  let res: SafeFetchResult;
  try {
    res = await safeFetch(u.toString(), { maxBytes: 1024 * 1024, timeoutMs: 8000, accept: 'text/xml,application/json,text/vtt,*/*;q=0.5', allowedContentTypes: /xml|json|vtt|text\/plain/i, headers: YT_HEADERS });
  } catch (e) {
    if (e instanceof FetchFailedError) return '';
    throw e;
  }
  return captionsToText(res.body.toString('utf8'));
}

/**
 * Cheapest-first text for a video link: 1) the page's own description, 2) captions (YouTube).
 * Never downloads the video itself. Throws the usual fetch/SSRF errors for unreachable pages.
 */
export async function fetchVideoText(rawUrl: string, locale: string): Promise<VideoTextResult | null> {
  const ref = detectVideoUrl(rawUrl);
  if (!ref) return null;
  const res = await safeFetch(ref.url, {
    maxBytes: 3 * 1024 * 1024,
    allowedContentTypes: /text\/html|application\/xhtml\+xml/i,
    headers: ref.platform === 'youtube' ? YT_HEADERS : undefined,
  });
  const meta = extractVideoMeta(decodeHtml(res.body, res.contentType));
  const header = meta.title ? `${meta.title}\n\n` : '';
  const base = { platform: ref.platform, title: meta.title, sourceUrl: ref.url, captionLang: null as string | null };

  if (descriptionLooksLikeRecipe(meta.description)) {
    return { ...base, source: 'description', text: (header + meta.description).slice(0, MAX_VIDEO_TEXT) };
  }

  const track = ref.platform === 'youtube' ? pickCaptionTrack(meta.captionTracks, locale) : null;
  const transcript = track ? await fetchCaptions(track.baseUrl) : '';
  if (transcript) {
    const text = `${header}${meta.description ? `${meta.description}\n\n` : ''}${transcript}`.slice(0, MAX_VIDEO_TEXT);
    return { ...base, source: 'captions', text, captionLang: track!.languageCode };
  }
  // Short description only (Reels/TikTok captions): still useful as an editable starting point.
  return { ...base, source: meta.description ? 'description' : 'none', text: (meta.description ? header + meta.description : header).slice(0, MAX_VIDEO_TEXT) };
}
