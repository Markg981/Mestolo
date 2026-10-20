'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/supabase/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { env } from '@/lib/env';
import { generateInviteToken, hashInviteToken, inviteUrl, isPlausibleInviteToken } from '@/lib/invites';
import { dbFailure, fail, ok, toFailure, type ActionResult } from './_utils';

const uuid = z.uuid();

/** Crea un invito. Il token in chiaro viene restituito una sola volta: nel database resta solo l'hash. */
export async function createInvite(): Promise<ActionResult<{ url: string }>> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    await enforceRateLimit('invite_create', user.id);
    const supabase = await createClient();
    const token = generateInviteToken();
    const { error } = await supabase.from('invites').insert({ token_hash: hashInviteToken(token) });
    if (error) {
      if (error.code === 'RL002') return fail('rate_limited');
      return dbFailure(error, 'createInvite');
    }
    revalidatePath('/friends');
    return ok({ url: inviteUrl(env().siteUrl, token) });
  } catch (e) {
    return toFailure(e, 'createInvite');
  }
}

export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !uuid.safeParse(inviteId).success) return fail('invalid_input');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('inviter_id', user.id)
    .is('revoked_at', null)
    .select('id');
  if (error) return dbFailure(error, 'revokeInvite');
  if (!data?.length) return fail('not_found');
  revalidatePath('/friends');
  return ok();
}

/** Accetta un invito: errore unico `not_found` per ogni causa (scaduto, revocato, esaurito, proprio...). */
export async function acceptInvite(token: string): Promise<ActionResult<{ status: 'accepted' | 'already_friends' }>> {
  try {
    const user = await getUser();
    if (!user) return fail('forbidden');
    if (!isPlausibleInviteToken(token)) return fail('not_found');
    await enforceRateLimit('invite_accept', user.id);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('accept_invite', { p_token: token });
    if (error) {
      if (error.code === 'IV001') return fail('not_found');
      return dbFailure(error, 'acceptInvite');
    }
    revalidatePath('/friends');
    return ok({ status: data === 'already_friends' ? 'already_friends' : 'accepted' });
  } catch (e) {
    return toFailure(e, 'acceptInvite');
  }
}
