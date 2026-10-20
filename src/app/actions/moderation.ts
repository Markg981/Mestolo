'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { dbFailure, fail, ok, type ActionResult } from './_utils';

/** Moderator actions. The permission check is done in the database (moderate_report). */
export async function moderateReport(reportId: string, action: 'hide' | 'restore' | 'dismiss'): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !z.uuid().safeParse(reportId).success || !['hide', 'restore', 'dismiss'].includes(action)) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.rpc('moderate_report', { p_report: reportId, p_action: action });
  if (error) return error.code === '42501' ? fail('forbidden') : dbFailure(error, 'moderateReport');
  revalidatePath('/moderation');
  return ok();
}
