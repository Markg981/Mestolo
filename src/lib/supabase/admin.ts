import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ConfigError, env } from '@/lib/env';
import { createTimeoutFetch } from '@/lib/supabase/fetch';

let cached: SupabaseClient | null = null;

/**
 * Service-role client: BYPASSES RLS. Use only on the server, only after the
 * caller's identity and permissions were verified, and only for:
 * encrypted API keys, AI usage/quotas, translation cache, rate limiting,
 * account deletion.
 */
export function createAdminClient(): SupabaseClient {
  const { supabaseUrl, serviceRoleKey } = env();
  if (!supabaseUrl || !serviceRoleKey) throw new ConfigError('SUPABASE_SERVICE_ROLE_KEY is not configured');
  if (!cached) {
    cached = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: createTimeoutFetch() },
    });
  }
  return cached;
}
