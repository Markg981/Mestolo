import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ProfileVisibility } from '@/lib/profile/validation';

export interface ProfileCard {
  id: string;
  username: string;
  display_name: string;
  /** false: the viewer only sees name and username */
  can_view: boolean;
  bio: string;
  avatar_path: string | null;
  location: string;
  website: string | null;
  favorite_cuisines: string[];
  /** only filled for the owner */
  profile_visibility: ProfileVisibility | null;
  friends_count: number | null;
  member_since: string | null;
}

/** Card of a profile as the current viewer may see it (security definer, respects profile_visibility and blocks). */
export async function getProfileCard(username: string): Promise<ProfileCard | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('get_profile_card', { p_username: username }).maybeSingle();
  return (data as ProfileCard | null) ?? null;
}

/** Which of these users have an avatar the viewer may see. */
export async function visibleAvatarIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const supabase = await createClient();
  const { data } = await supabase.rpc('get_avatar_paths', { p_ids: ids });
  return new Set(((data as { id: string }[]) ?? []).map((r) => r.id));
}

/** Small author card for pages that show who wrote a recipe (e.g. public recipe pages). */
export interface AuthorCard {
  username: string;
  displayName: string;
  avatarUserId: string | null;
}
export async function getAuthorCard(username: string): Promise<AuthorCard | null> {
  const card = await getProfileCard(username);
  if (!card) return null;
  return { username: card.username, displayName: card.display_name, avatarUserId: card.can_view && card.avatar_path ? card.id : null };
}
