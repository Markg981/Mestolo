import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));

import { enforceAuthRateLimit } from '@/lib/rate-limit';

describe('enforceAuthRateLimit con le sole variabili di autenticazione', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('non fallisce per CRON_SECRET mancante', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PHASE', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://x');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'a');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 's');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://x');
    vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
    vi.stubEnv('CRON_SECRET', '');
    await expect(enforceAuthRateLimit('login_ip', 'subj')).resolves.toBeUndefined();
  });
});
