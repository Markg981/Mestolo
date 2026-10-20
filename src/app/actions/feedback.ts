'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const feedbackSchema = z.object({
  kind: z.enum(['bug', 'idea', 'other']),
  message: z.string().trim().min(5).max(4000),
  platform: z.enum(['web', 'android', 'ios']),
  appVersion: z.string().trim().max(40).optional(),
  pagePath: z.string().trim().max(300).optional(),
});

/** Saves feedback for the signed-in user. RLS and the daily-limit trigger enforce the rules again in the database. */
export async function sendFeedback(input: z.input<typeof feedbackSchema>): Promise<ActionResult> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    const parsed = feedbackSchema.safeParse(input);
    if (!parsed.success) return fail('invalid_input');
    await enforceRateLimit('feedback_send', user.id);
    const ua = ((await headers()).get('user-agent') ?? '').slice(0, 300);
    const supabase = await createClient();
    const { error } = await supabase.from('app_feedback').insert({
      kind: parsed.data.kind,
      message: parsed.data.message,
      platform: parsed.data.platform,
      app_version: parsed.data.appVersion || null,
      page_path: parsed.data.pagePath || null,
      user_agent: ua || null,
    });
    if (error) return dbFailure(error, 'sendFeedback');
    revalidatePath('/moderation/feedback');
    return ok();
  } catch (e) {
    return toFailure(e, 'sendFeedback');
  }
}

/** Moderators only (RLS: no other user can update rows). */
export async function setFeedbackStatus(id: string, status: 'new' | 'seen' | 'done'): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !z.uuid().safeParse(id).success || !['new', 'seen', 'done'].includes(status)) return fail('invalid_input');
  const supabase = await createClient();
  const { data, error } = await supabase.from('app_feedback').update({ status }).eq('id', id).select('id');
  if (error) return dbFailure(error, 'setFeedbackStatus');
  if (!data?.length) return fail('forbidden');
  revalidatePath('/moderation/feedback');
  return ok();
}
