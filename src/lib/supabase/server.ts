import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { ConfigError, env } from '@/lib/env';

/** Supabase client acting AS the signed-in user: every query is subject to RLS. */
export async function createClient(): Promise<SupabaseClient> {
  const { supabaseUrl, supabaseAnonKey } = env();
  if (!supabaseUrl || !supabaseAnonKey) throw new ConfigError('Supabase is not configured');
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

/** Returns the authenticated user (validated with the Auth server), or null. */
export const getUser = cache(async (): Promise<User | null> => {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  locale: string;
  discoverable: boolean;
  dietary_preferences: string[];
  avoided_ingredients: string[];
  hidden_categories: string[];
  is_moderator: boolean;
}

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc('my_profile').maybeSingle();
  return (data as Profile) ?? null;
});
