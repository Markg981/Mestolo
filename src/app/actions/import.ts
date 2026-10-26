'use server';

import { z } from 'zod';
import { getUser } from '@/lib/supabase/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { safeFetch } from '@/lib/import/safe-fetch';
import { decodeHtml } from '@/lib/import/decode-html';
import { recipeFromHtml } from '@/lib/import/recipe-from-html';
import { parseRecipeText } from '@/lib/recipes/text-parser';
import { detectRecipeLanguage } from '@/lib/recipes/detect-language';
import { isLocale, DEFAULT_LOCALE } from '@/i18n/config';
import { suggestCategory } from '@/lib/recipes/classify';
import { prepareOcrPage, ImageValidationError } from '@/lib/images/process';
import { resolveProvider, recordUsage } from '@/lib/ai/service';
import { refundQuota } from '@/lib/ai/refund';
import { EXTRACT_SYSTEM, extractUserPrompt } from '@/lib/ai/prompts';
import { draftFromExtraction } from '@/lib/ai/extraction';
import type { ImportDraft } from '@/lib/recipes/types';
import { MAX_PAGE_BYTES, MAX_PHOTO_PAGES, MAX_TOTAL_BYTES } from '@/lib/import/limits';
import { fetchVideoText, type VideoTextResult } from '@/lib/import/video-import';
import { detectVideoUrl } from '@/lib/import/video';
import { MAX_AUDIO_BYTES } from '@/lib/import/limits';
import { fail, ok, toFailure, type ActionResult } from './_utils';


export type UrlImportResult = { draft: ImportDraft | null; pageText: string };

/** URL import: schema.org first, then microdata, then readable page text. No AI needed. */
export async function importFromUrl(rawUrl: string): Promise<ActionResult<UrlImportResult>> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const url = z.string().trim().min(8).max(2000).safeParse(rawUrl);
    if (!url.success) return fail('url_invalid');
    await enforceRateLimit('import_url', user.id);
    const res = await safeFetch(url.data, {
      maxBytes: 3 * 1024 * 1024,
      allowedContentTypes: /text\/html|application\/xhtml\+xml/i,
    });
    const html = decodeHtml(res.body, res.contentType);
    const { draft, pageText } = recipeFromHtml(html, res.finalUrl);
    if (!draft) return ok({ draft: null, pageText: pageText.slice(0, 8000) });
    if (res.truncated) draft.warnings.push({ code: 'partial_content' });
    return ok({ draft, pageText: '' });
  } catch (e) {
    return toFailure(e, 'importFromUrl');
  }
}

/** Pasted text: heuristic parser (free) or, if the user chooses, an AI provider. */
export async function importFromText(text: string, useAi: boolean, sourceUrl?: string | null, uiLocale?: string): Promise<ActionResult<ImportDraft>> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const t = z.string().trim().min(10).max(20000).safeParse(text);
    if (!t.success) return fail('invalid_input');
    const src = sourceUrl && /^https?:\/\//.test(sourceUrl) ? sourceUrl.slice(0, 2000) : null;

    if (useAi) {
      await enforceRateLimit('ai_text', user.id);
      const resolved = await resolveProvider(user.id, 'text', 'text', 'extract_text');
      let draft: ImportDraft;
      let extracted: unknown;
      try {
        const raw = await resolved.provider.completeJson({ system: EXTRACT_SYSTEM, user: extractUserPrompt(0, t.data), maxTokens: 4000 });
        extracted = raw;
      } catch (e) {
        await refundQuota(user.id, resolved, 'text', 'extract_text');
        throw e;
      }
      // Dopo la chiamata al provider (gia' pagata): niente rimborso se l'output non e' valido.
      draft = draftFromExtraction(extracted, { type: src ? 'url' : 'text', url: src, method: 'ai' });
      await recordUsage(user.id, 'text', 'extract_text', resolved);
      return ok(draft);
    }

    const language = detectRecipeLanguage(t.data, isLocale(uiLocale) ? uiLocale : DEFAULT_LOCALE);
    const p = parseRecipeText(t.data);
    const cat = suggestCategory({ title: p.title, description: p.description, ingredients: p.ingredients });
    return ok({
      content: {
        title: p.title.slice(0, 200),
        description: p.description,
        original_language: language,
        servings: p.servings,
        prep_minutes: p.prep_minutes,
        cook_minutes: p.cook_minutes,
        total_minutes: p.total_minutes,
        ingredients: p.ingredients,
        steps: p.steps,
        tags: [],
        category_slug: cat.slug,
      },
      field_flags: p.field_flags,
      warnings: p.warnings,
      categoryConfidence: cat.confidence,
      source: { type: src ? 'url' : 'text', url: src, method: 'heuristic' },
    });
  } catch (e) {
    return toFailure(e, 'importFromText');
  }
}

/**
 * Photo import (one or more pages, in the order chosen by the user).
 * Requires a provider that can actually read images; without one we return
 * ai_not_configured and the UI offers manual entry — OCR is never simulated.
 * Photos are processed in memory and NOT stored.
 */
export async function importFromPhotos(formData: FormData): Promise<ActionResult<ImportDraft>> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const files = formData.getAll('pages').filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) return fail('invalid_input');
    if (files.length > MAX_PHOTO_PAGES) return fail('too_many_files');
    const total = files.reduce((s, f) => s + f.size, 0);
    if (files.some((f) => f.size > MAX_PAGE_BYTES) || total > MAX_TOTAL_BYTES) return fail('image_too_large');

    // Rate limit and image validation come first: the quota is consumed by resolveProvider.
    await enforceRateLimit('import_photo', user.id);
    const images = [];
    for (const f of files) {
      const jpeg = await prepareOcrPage(Buffer.from(await f.arrayBuffer()));
      images.push({ mime: 'image/jpeg' as const, base64: jpeg.toString('base64') });
    }

    const resolved = await resolveProvider(user.id, 'vision', 'vision', 'extract_photo');
    let draft: ImportDraft;
    let extracted: unknown;
    try {
      const raw = await resolved.provider.completeJson({
        system: EXTRACT_SYSTEM,
        user: extractUserPrompt(images.length),
        images,
        maxTokens: 6000,
      });
      extracted = raw;
    } catch (e) {
      await refundQuota(user.id, resolved, 'vision', 'extract_photo');
      throw e;
    }
    // Dopo la chiamata al provider (gia' pagata): niente rimborso se l'output non e' valido.
    draft = draftFromExtraction(extracted, { type: 'photo', method: 'ai' });
    await recordUsage(user.id, 'vision', 'extract_photo', resolved);
    return ok(draft);
  } catch (e) {
    if (e instanceof ImageValidationError) return fail(e.code);
    return toFailure(e, 'importFromPhotos');
  }
}

export type VideoImportResult = { video: VideoTextResult };

/**
 * Video link (YouTube/Shorts, TikTok, Instagram Reels): description first, then captions.
 * Free, no AI, never downloads the video. `source: 'none'` tells the UI to offer the AI/paste paths.
 */
export async function importFromVideoUrl(rawUrl: string, uiLocale?: string): Promise<ActionResult<VideoImportResult>> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const url = z.string().trim().min(8).max(2000).safeParse(rawUrl);
    if (!url.success || !detectVideoUrl(url.data)) return fail('url_invalid');
    await enforceRateLimit('import_url', user.id);
    const video = await fetchVideoText(url.data, isLocale(uiLocale) ? uiLocale : DEFAULT_LOCALE);
    if (!video) return fail('url_invalid');
    return ok({ video });
  } catch (e) {
    return toFailure(e, 'importFromVideoUrl');
  }
}

const AUDIO_MIME = /^audio\/(wav|x-wav|wave|mpeg|mp3|mp4|m4a|x-m4a|webm|ogg)$/i;

/**
 * Speech-to-text on an audio track (extracted in the browser from an uploaded video). Explicit AI
 * option: uses the user's own OpenAI key or the app's quota. Audio is processed in memory, not stored.
 */
export async function transcribeVideoAudio(formData: FormData): Promise<ActionResult<{ text: string }>> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const file = formData.get('audio');
    if (!(file instanceof File) || file.size === 0) return fail('invalid_input');
    if (file.size > MAX_AUDIO_BYTES || !AUDIO_MIME.test(file.type.split(';')[0])) return fail('invalid_input');
    await enforceRateLimit('import_video_ai', user.id);
    const data = new Uint8Array(await file.arrayBuffer());
    const resolved = await resolveProvider(user.id, 'audio', 'text', 'transcribe');
    if (!resolved.provider.transcribe) {
      await refundQuota(user.id, resolved, 'text', 'transcribe');
      return fail('ai_unsupported');
    }
    let text: string;
    try {
      text = await resolved.provider.transcribe({
        data,
        mime: file.type.split(';')[0],
        filename: /wav|wave/i.test(file.type) ? 'audio.wav' : 'audio.m4a',
      });
    } catch (e) {
      await refundQuota(user.id, resolved, 'text', 'transcribe');
      throw e;
    }
    if (!text) {
      // Provider gia' chiamato (a pagamento): nessun rimborso.
      await recordUsage(user.id, 'text', 'transcribe', resolved);
      return fail('ai_bad_output');
    }
    await recordUsage(user.id, 'text', 'transcribe', resolved);
    return ok({ text: text.slice(0, 20000) });
  } catch (e) {
    return toFailure(e, 'transcribeVideoAudio');
  }
}
