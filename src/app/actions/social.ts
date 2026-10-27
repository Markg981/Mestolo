'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const uuid = z.uuid();

export async function searchUsers(q: string): Promise<{ id: string; username: string; display_name: string }[]> {
  const user = await getUser();
  if (!user || typeof q !== 'string' || q.trim().length < 2) return [];
  try {
    await enforceRateLimit('user_search', user.id);
  } catch {
    return [];
  }
  const supabase = await createClient();
  const { data } = await supabase.rpc('search_profiles', { q: q.slice(0, 40) });
  return (data as { id: string; username: string; display_name: string }[]) ?? [];
}

export async function sendFriendRequest(addresseeId: string): Promise<ActionResult> {
  try {
    const user = await getUser();
    if (!user || !uuid.safeParse(addresseeId).success || addresseeId === user.id) return fail('invalid_input');
    await enforceRateLimit('friend_request', user.id);
    const supabase = await createClient();
    const { error } = await supabase.from('friendships').insert({ requester_id: user.id, addressee_id: addresseeId });
    if (error) return dbFailure(error, 'sendFriendRequest');
    revalidatePath('/friends');
    return ok();
  } catch (e) {
    return toFailure(e, 'sendFriendRequest');
  }
}

export async function respondFriendRequest(friendshipId: string, accept: boolean): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(friendshipId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('friendships')
    .update({ status: accept ? 'accepted' : 'declined' })
    .eq('id', friendshipId)
    .eq('addressee_id', user.id)
    .eq('status', 'pending')
    .select('id');
  if (error) return dbFailure(error, 'respondFriendRequest');
  if (!data?.length) return fail('not_found');
  revalidatePath('/friends');
  return ok();
}

/** Cancels a sent request, removes a friend, or clears a declined request. */
export async function removeFriendship(friendshipId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(friendshipId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { data, error } = await supabase.from('friendships').delete().eq('id', friendshipId).select('id');
  if (error) return dbFailure(error, 'removeFriendship');
  if (!data?.length) return fail('not_found');
  revalidatePath('/friends');
  return ok();
}

export async function blockUser(userId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(userId).success || userId === user.id) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('blocks').upsert({ blocker_id: user.id, blocked_id: userId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
  if (error) return dbFailure(error, 'blockUser');
  revalidatePath('/friends');
  return ok();
}

export async function unblockUser(userId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(userId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { error } = await supabase.from('blocks').delete().eq('blocker_id', user.id).eq('blocked_id', userId);
  if (error) return dbFailure(error, 'unblockUser');
  revalidatePath('/friends');
  return ok();
}

const reportSchema = z.object({
  recipeId: z.uuid(),
  reason: z.enum(['spam', 'offensive', 'copyright', 'unsafe', 'other']),
  details: z.string().max(1000).default(''),
});

export async function reportRecipe(input: unknown): Promise<ActionResult> {
  try {
    const user = await getUser();
    const p = reportSchema.safeParse(input);
    if (!user || !p.success) return fail('invalid_input');
    await enforceRateLimit('report', user.id);
    const supabase = await createClient();
    const { error } = await supabase.from('reports').insert({ reporter_id: user.id, recipe_id: p.data.recipeId, reason: p.data.reason, details: p.data.details });
    if (error) return dbFailure(error, 'reportRecipe');
    return ok();
  } catch (e) {
    return toFailure(e, 'reportRecipe');
  }
}
