'use server';

import { z } from 'zod';
import { getUser } from '@/lib/supabase/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { safeFetch } from '@/lib/import/safe-fetch';
import { recipeFromHtml } from '@/lib/import/recipe-from-html';
import { parseRecipeText } from '@/lib/recipes/text-parser';
import { suggestCategory } from '@/lib/recipes/classify';
import { prepareOcrPage, ImageValidationError } from '@/lib/images/process';
import { resolveProvider, recordUsage } from '@/lib/ai/service';
import { EXTRACT_SYSTEM, extractUserPrompt } from '@/lib/ai/prompts';
import { draftFromExtraction } from '@/lib/ai/extraction';
import type { ImportDraft } from '@/lib/recipes/types';
import { MAX_PAGE_BYTES, MAX_PHOTO_PAGES, MAX_TOTAL_BYTES } from '@/lib/import/limits';
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
    const html = res.body.toString('utf8');
    const { draft, pageText } = recipeFromHtml(html, res.finalUrl);
    if (!draft) return ok({ draft: null, pageText: pageText.slice(0, 8000) });
    if (res.truncated) draft.warnings.push({ code: 'partial_content' });
    return ok({ draft, pageText: '' });
  } catch (e) {
    return toFailure(e, 'importFromUrl');
  }
}

/** Pasted text: heuristic parser (free) or, if the user chooses, an AI provider. */
export async function importFromText(text: string, useAi: boolean, sourceUrl?: string | null): Promise<ActionResult<ImportDraft>> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const t = z.string().trim().min(10).max(20000).safeParse(text);
    if (!t.success) return fail('invalid_input');
    const src = sourceUrl && /^https?:\/\//.test(sourceUrl) ? sourceUrl.slice(0, 2000) : null;

    if (useAi) {
      await enforceRateLimit('ai_text', user.id);
      const resolved = await resolveProvider(user.id, 'text', 'text', 'extract_text');
      const raw = await resolved.provider.completeJson({ system: EXTRACT_SYSTEM, user: extractUserPrompt(0, t.data), maxTokens: 4000 });
      await recordUsage(user.id, 'text', 'extract_text', resolved);
      return ok(draftFromExtraction(raw, { type: src ? 'url' : 'text', url: src, method: 'ai' }));
    }

    const p = parseRecipeText(t.data);
    const cat = suggestCategory({ title: p.title, description: p.description, ingredients: p.ingredients });
    return ok({
      content: {
        title: p.title.slice(0, 200),
        description: p.description,
        original_language: 'it',
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

    // Resolve the provider before doing heavy work, so "not configured" is immediate.
    const resolved = await resolveProvider(user.id, 'vision', 'vision', 'extract_photo');
    await enforceRateLimit('import_photo', user.id);

    const images = [];
    for (const f of files) {
      const jpeg = await prepareOcrPage(Buffer.from(await f.arrayBuffer()));
      images.push({ mime: 'image/jpeg' as const, base64: jpeg.toString('base64') });
    }
    const raw = await resolved.provider.completeJson({
      system: EXTRACT_SYSTEM,
      user: extractUserPrompt(images.length),
      images,
      maxTokens: 6000,
    });
    await recordUsage(user.id, 'vision', 'extract_photo', resolved);
    return ok(draftFromExtraction(raw, { type: 'photo', method: 'ai' }));
  } catch (e) {
    if (e instanceof ImageValidationError) return fail(e.code);
    return toFailure(e, 'importFromPhotos');
  }
}
