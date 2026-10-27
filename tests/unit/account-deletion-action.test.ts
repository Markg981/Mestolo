import { beforeEach, describe, expect, it, vi } from 'vitest';

// End-to-end flow of the deleteAccount server action: the real deleteAccountData runs against a mocked admin client.
const getUser = vi.fn();
const calls: string[] = [];
const profileEqs: [string, unknown][] = [];
const signOut = vi.fn();
const deleteUser = vi.fn();
const removed: { bucket: string; paths: string[] }[] = [];
let profileRes: { data: unknown };
let publicRows: unknown[];
const revalidateTag = vi.fn();
let myProfile: { data: unknown };
let avatarRemoveError: { message: string } | null;
let imageRemoveError: { message: string } | null;
let imageRows: unknown[];
let deleteUserError: { status?: number; code?: string; message?: string } | null;

class RedirectSignal extends Error {
  constructor(public url: string) {
    super('NEXT_REDIRECT');
  }
}

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: (c: string, v: unknown) => (profileEqs.push([c, v]), { single: async () => profileRes, not: async () => ({ data: publicRows }) }),
      }),
    }),
    rpc: (fn: string) => (calls.push(`rpc:${fn}`), { maybeSingle: async () => myProfile }),
    auth: { signOut: async () => (calls.push('signOut'), signOut()) },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: async () => (calls.push(`list:${table}`), table === 'cook_logs' ? { data: [{ photo_path: 'u1/cook/c.webp' }], error: null } : { data: imageRows, error: null }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          calls.push(`remove:${bucket}`);
          removed.push({ bucket, paths });
          return { error: bucket === 'avatars' ? avatarRemoveError : imageRemoveError };
        },
        // purgePrefix sweep: nothing left under <uid>/ once the listed files are removed
        list: async () => ({ data: [], error: null }),
      }),
    },
    auth: { admin: { deleteUser: async (id: string) => (calls.push('deleteUser'), deleteUser(id), { error: deleteUserError }) } },
  }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn() }), headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f, revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    calls.push(`redirect:${url}`);
    throw new RedirectSignal(url);
  },
}));
vi.mock('@/lib/rate-limit', () => ({ RateLimitedError: class RateLimitedError extends Error {}, enforceRateLimit: vi.fn() }));
// Re-authentication with the password on a separate, non-persistent client
let reauthUserId: string | null;
const signInWithPassword = vi.fn(async () => (reauthUserId ? { data: { user: { id: reauthUserId } }, error: null } : { data: { user: null }, error: { message: 'Invalid login credentials' } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { signInWithPassword } }) }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  env: () => ({ supabaseUrl: 'http://supabase.test', supabaseAnonKey: 'anon' }),
}));

import { deleteAccount } from '@/app/actions/settings';

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  profileEqs.length = 0;
  removed.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  getUser.mockResolvedValue({ id: 'u1', email: 'ada@example.com' });
  reauthUserId = 'u1';
  profileRes = { data: { username: 'ada' } };
  publicRows = [{ public_slug: 'torta-1' }, { public_slug: 'zuppa-2' }];
  myProfile = { data: { avatar_path: 'u1/face.webp' } };
  avatarRemoveError = null;
  imageRemoveError = null;
  imageRows = [{ storage_path: 'u1/r1/a.webp', thumb_path: 'u1/r1/a_t.webp' }];
  deleteUserError = null;
});

describe('deleteAccount action', () => {
  it('invalidates the cached public pages of the user after the deletion', async () => {
    expect(await deleteAccount('ada', 'pw')).toMatchObject({ ok: true });
    expect(revalidateTag).toHaveBeenCalledWith('public-recipe:torta-1', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('public-recipe:zuppa-2', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('public-recipes', 'max');
    expect(deleteUser.mock.invocationCallOrder[0]).toBeLessThan(revalidateTag.mock.invocationCallOrder[0]);
  });

  it('does not invalidate anything when the deletion fails', async () => {
    deleteUserError = { status: 500, message: 'boom' };
    await deleteAccount('ada', 'pw');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers before reading or deleting anything', async () => {
    getUser.mockResolvedValue(null);
    expect(await deleteAccount('ada', 'pw')).toMatchObject({ ok: false, error: 'forbidden' });
    expect(calls).toEqual([]);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('re-authenticates the signed-in user with the password before anything else', async () => {
    await deleteAccount('ada', 'pw').catch(() => {});
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'pw' });
  });

  it.each([
    ['wrong password', () => (reauthUserId = null), 'pw'],
    ['password of another account', () => (reauthUserId = 'u2'), 'pw'],
    ['empty password', () => {}, ''],
  ])('refuses on %s and deletes nothing', async (_n, arrange, password) => {
    arrange();
    expect(await deleteAccount('ada', password)).toMatchObject({ ok: false, error: 'auth_invalid' });
    expect(profileEqs).toEqual([]);
    expect(calls).toEqual([]);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('reads the username of the signed-in user only', async () => {
    await deleteAccount('ada', 'pw').catch(() => {});
    expect(profileEqs).toEqual([['id', 'u1'], ['owner_id', 'u1']]);
  });

  it.each([['wrong'], [''], ['ada2'], [undefined as unknown as string]])('refuses a wrong confirmation (%s) and deletes nothing', async (typed) => {
    expect(await deleteAccount(typed, 'pw')).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(calls).toEqual([]);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('refuses when the profile cannot be found', async () => {
    profileRes = { data: null };
    expect(await deleteAccount('ada', 'pw')).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('accepts the username case-insensitively and trimmed', async () => {
    expect(await deleteAccount('  ADA ', 'pw')).toEqual({ ok: true, data: undefined });
    expect(deleteUser).toHaveBeenCalledWith('u1');
  });

  // Niente redirect lato server: il client svuota prima cache del service worker e bozze locali.
  it('runs in order: avatar, listing, storage cleanup, auth user, sign out, without redirecting', async () => {
    expect(await deleteAccount('ada', 'pw')).toEqual({ ok: true, data: undefined });
    expect(calls).toEqual([
      'rpc:my_profile',
      'remove:avatars',
      'list:recipe_images',
      'list:cook_logs',
      'remove:recipe-images',
      'deleteUser',
      'signOut',
    ]);
    expect(removed).toEqual([
      { bucket: 'avatars', paths: ['u1/face.webp'] },
      { bucket: 'recipe-images', paths: ['u1/r1/a.webp', 'u1/r1/a_t.webp', 'u1/cook/c.webp'] },
    ]);
    expect(deleteUser).toHaveBeenCalledWith('u1');
  });

  it('skips the avatar removal when the profile has no avatar', async () => {
    myProfile = { data: { avatar_path: null } };
    expect(await deleteAccount('ada', 'pw')).toEqual({ ok: true, data: undefined });
    expect(removed.map((r) => r.bucket)).toEqual(['recipe-images']);
  });

  it('aborts before touching the account when the avatar cannot be removed', async () => {
    avatarRemoveError = { message: 'storage down' };
    expect(await deleteAccount('ada', 'pw')).toMatchObject({ ok: false, error: 'generic' });
    expect(calls).toEqual(['rpc:my_profile', 'remove:avatars']);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('keeps the auth user and the session when recipe storage cleanup fails midway (retryable)', async () => {
    imageRemoveError = { message: 'storage down' };
    expect(await deleteAccount('ada', 'pw')).toMatchObject({ ok: false, error: 'generic' });
    expect(calls).toEqual(['rpc:my_profile', 'remove:avatars', 'list:recipe_images', 'list:cook_logs', 'remove:recipe-images']);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(calls.some((c) => c.startsWith('redirect'))).toBe(false);
  });

  it('keeps the session and does not redirect when the auth user deletion fails', async () => {
    deleteUserError = { status: 500, message: 'auth down' };
    expect(await deleteAccount('ada', 'pw')).toMatchObject({ ok: false, error: 'generic' });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
    expect(calls.some((c) => c.startsWith('redirect'))).toBe(false);
  });

  it('treats an already deleted auth user as success (idempotent retry) and still signs out', async () => {
    deleteUserError = { status: 404, code: 'user_not_found' };
    expect(await deleteAccount('ada', 'pw')).toEqual({ ok: true, data: undefined });
    expect(calls).toContain('signOut');
  });

  it('does not leak the failure message to the caller', async () => {
    avatarRemoveError = { message: 'secret-token-abc123' };
    const res = await deleteAccount('ada', 'pw');
    expect(JSON.stringify(res)).not.toContain('secret-token');
  });
});
