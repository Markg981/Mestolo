'use server';

import { z } from 'zod';
import { createClient, getUser, getProfile } from '@/lib/supabase/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { resolveProvider, recordUsage } from '@/lib/ai/service';
import { cookAssistSystem, cookAssistUserPrompt } from '@/lib/ai/prompts';
import { cookAnswerSchema, cookAskSchema, truncateHistory, type CookAskInput } from '@/lib/cooking/assistant';
import type { RecipeRow } from '@/lib/recipes/types';
import { fail, ok, toFailure, type ActionResult } from './_utils';

/** Quick question while cooking. Recipe must be visible to the user (RLS); same quota/rate limit as the other text AI features. */
export async function askCookAssistant(recipeId: string, input: CookAskInput): Promise<ActionResult<{ answer: string }>> {
  try {
    const user = await getUser();
    if (!user || !z.uuid().safeParse(recipeId).success) return fail('forbidden');
    const parsed = cookAskSchema.safeParse(input);
    if (!parsed.success) return fail('invalid_input');
    const supabase = await createClient();
    const { data } = await supabase.from('recipes').select('*').eq('id', recipeId).maybeSingle(); // RLS: must be visible
    if (!data) return fail('not_found');
    const r = data as RecipeRow;
    const locale = (await getProfile())?.locale ?? 'it';
    await enforceRateLimit('ai_text', user.id);
    const resolved = await resolveProvider(user.id, 'text', 'text', 'cook_assist');
    const raw = await resolved.provider.completeJson({
      system: cookAssistSystem(locale),
      user: cookAssistUserPrompt(
        {
          title: r.title,
          description: r.description,
          servings: r.servings === null ? null : Number(r.servings),
          prep_minutes: r.prep_minutes,
          cook_minutes: r.cook_minutes,
          total_minutes: r.total_minutes,
          ingredients: r.ingredients ?? [],
          steps: r.steps ?? [],
        },
        { stepIndex: parsed.data.stepIndex, servings: parsed.data.servings, history: truncateHistory(parsed.data.history), question: parsed.data.question },
      ),
      maxTokens: 500,
    });
    await recordUsage(user.id, 'text', 'cook_assist', resolved);
    const out = cookAnswerSchema.safeParse(raw);
    if (!out.success) return fail('ai_bad_output');
    return ok({ answer: out.data.answer });
  } catch (e) {
    return toFailure(e, 'askCookAssistant');
  }
}
