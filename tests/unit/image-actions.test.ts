import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const revalidatePath = vi.fn();
const enforceRateLimit = vi.fn();
const safeFetch = vi.fn();
const processRecipeImage = vi.fn();
const processAvatar = vi.fn();
const userOverImageQuota = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const buckets: string[] = [];
const inserts: Record<string, unknown>[] = [];
const profileUpdates: { payload: unknown; eqs: [string, unknown][] }[] = [];
const rpc = vi.fn();
let recipeRow: unknown;
let insertRes: { data?: unknown; error: unknown };
let profileUpdateRes: { error: unknown };

function userBuilder(table: string) {
  const eqs: [string, unknown][] = [];
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (p: Record<string, unknown>) => (inserts.push(p), b),
    eq: (c: string, v: unknown) => (eqs.push([c, v]), (table === 'recipes' && (b.eqs = eqs)), b),
    maybeSingle: async () => ({ data: recipeRow }),
    single: async () => insertRes,
    then: (res: (v: unknown) => unknown) => Promise.resolve({ count: 3 }).then(res), // count of existing images
  };
  return b;
}

const recipeEqs: [string, unknown][][] = [];
vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUser(),
  createClient: async () => ({
    // insert_recipe_image (riga immagine, posizione e quota sotto lock nel DB) si attende direttamente; my_profile usa maybeSingle.
    rpc: (fn: string, args: Record<string, unknown>) =>
      fn === 'insert_recipe_image' ? (inserts.push(args), Promise.resolve(insertRes)) : { maybeSingle: async () => rpc(fn, args) },
    from: (t: string) => {
      const b = userBuilder(t);
      if (t === 'recipes') {
        const orig = b.eq as (c: string, v: unknown) => unknown;
        const mine: [string, unknown][] = [];
        recipeEqs.push(mine);
        b.eq = (c: string, v: unknown) => (mine.push([c, v]), orig(c, v));
      }
      return b;
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: { from: (name: string) => (buckets.push(name), { upload, remove }) },
    from: () => ({
      update: (payload: unknown) => {
        const rec = { payload, eqs: [] as [string, unknown][] };
        profileUpdates.push(rec);
        return { eq: async (c: string, v: unknown) => (rec.eqs.push([c, v]), profileUpdateRes) };
      },
    }),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('@/lib/rate-limit', () => ({
  RateLimitedError: class RateLimitedError extends Error {},
  enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a),
}));
vi.mock('@/lib/images/quota', () => ({ userOverImageQuota: (...a: unknown[]) => userOverImageQuota(...a) }));
vi.mock('@/lib/images/process', () => ({
  ImageValidationError: class ImageValidationError extends Error {
    constructor(public code: 'image_invalid' | 'image_too_large') {
      super(code);
    }
  },
  processRecipeImage: (...a: unknown[]) => processRecipeImage(...a),
  processAvatar: (...a: unknown[]) => processAvatar(...a),
}));
vi.mock('@/lib/import/safe-fetch', async (orig) => ({ ...(await orig<typeof import('@/lib/import/safe-fetch')>()), safeFetch: (...a: unknown[]) => safeFetch(...a) }));

import { importSourceImage } from '@/app/actions/images';
import { uploadAvatar } from '@/app/actions/profile';
import { ImageValidationError } from '@/lib/images/process';
import { RateLimitedError } from '@/lib/rate-limit';
import { FetchFailedError } from '@/lib/import/safe-fetch';
import { UnsafeUrlError } from '@/lib/import/ssrf';

const R = '3f2b8a4e-1c5d-4e6f-8a9b-0c1d2e3f4a5b';
const processed = { full: Buffer.from('full'), thumb: Buffer.from('thumb'), width: 800, height: 600 };

beforeEach(() => {
  vi.clearAllMocks();
  buckets.length = 0;
  inserts.length = 0;
  profileUpdates.length = 0;
  recipeEqs.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  getUser.mockResolvedValue({ id: 'u1' });
  enforceRateLimit.mockResolvedValue(undefined);
  userOverImageQuota.mockResolvedValue(false);
  upload.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
  recipeRow = { id: R, source_url: 'https://example.com/ricetta' };
  insertRes = { data: 'img1', error: null };
  profileUpdateRes = { error: null };
  safeFetch.mockResolvedValue({ body: Buffer.from('bytes'), truncated: false, finalUrl: 'https://cdn.example.com/a.jpg' });
  processRecipeImage.mockResolvedValue(processed);
  processAvatar.mockResolvedValue(Buffer.from('avatar'));
  rpc.mockResolvedValue({ data: { avatar_path: 'u1/old.webp' } });
});

describe('importSourceImage', () => {
  const run = (url = 'https://example.com/a.jpg') => importSourceImage(R, url, 'Credit');

  it('rejects unauthenticated callers and bad recipe ids before any network access', async () => {
    getUser.mockResolvedValue(null);
    expect(await run()).toMatchObject({ ok: false, error: 'forbidden' });
    getUser.mockResolvedValue({ id: 'u1' });
    expect(await importSourceImage('nope', 'https://x.com/a.jpg', null)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('rejects an image host different from the recipe source_url, without fetching', async () => {
    expect(await run('https://evil.test/a.jpg')).toMatchObject({ ok: false, error: 'invalid_input' });
    recipeRow = { id: R, source_url: null };
    expect(await run()).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('accepts the same host and sibling CDN subdomains of the source_url', async () => {
    expect(await run('https://example.com/b.jpg')).toMatchObject({ ok: true });
    expect(await run('https://cdn.example.com/b.jpg')).toMatchObject({ ok: true });
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });

  it('applies both upload rate limits and maps a rate-limit error', async () => {
    await run();
    expect(enforceRateLimit).toHaveBeenCalledWith('upload_image', 'u1');
    expect(enforceRateLimit).toHaveBeenCalledWith('upload_image_day', 'u1');
    enforceRateLimit.mockRejectedValue(new RateLimitedError('upload_image'));
    expect(await run()).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });

  it('fetches with the size cap and an image-only content type filter', async () => {
    await run('https://example.com/a.jpg');
    const [url, opts] = safeFetch.mock.calls[0];
    expect(url).toBe('https://example.com/a.jpg');
    expect(opts.maxBytes).toBe(3.5 * 1024 * 1024);
    expect(opts.allowedContentTypes.test('image/png')).toBe(true);
    expect(opts.allowedContentTypes.test('text/html')).toBe(false);
    expect(opts.allowedContentTypes.test('image/svg+xml')).toBe(false);
  });

  it('rejects a truncated (too large) download without processing it', async () => {
    safeFetch.mockResolvedValue({ body: Buffer.alloc(1), truncated: true, finalUrl: 'https://x.com/a.jpg' });
    expect(await run()).toMatchObject({ ok: false, error: 'image_too_large' });
    expect(processRecipeImage).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('maps SSRF and fetch errors to url_* codes', async () => {
    safeFetch.mockRejectedValue(new UnsafeUrlError('private_address'));
    expect(await run()).toMatchObject({ ok: false, error: 'url_blocked' });
    safeFetch.mockRejectedValue(new FetchFailedError('timeout'));
    expect(await run()).toMatchObject({ ok: false, error: 'url_timeout' });
    safeFetch.mockRejectedValue(new FetchFailedError('content_type'));
    expect(await run()).toMatchObject({ ok: false, error: 'url_not_html' });
  });

  it('only imports into a recipe owned by the user', async () => {
    recipeRow = null;
    expect(await run()).toMatchObject({ ok: false, error: 'not_found' });
    expect(recipeEqs[0]).toEqual([['id', R], ['owner_id', 'u1']]);
    expect(upload).not.toHaveBeenCalled();
  });

  it('stops at the image quota', async () => {
    userOverImageQuota.mockResolvedValue(true);
    expect(await run()).toMatchObject({ ok: false, error: 'storage_quota_exceeded' });
    expect(processRecipeImage).not.toHaveBeenCalled();
  });

  it('maps an undecodable image to image_invalid', async () => {
    processRecipeImage.mockRejectedValue(new ImageValidationError('image_invalid'));
    expect(await run()).toMatchObject({ ok: false, error: 'image_invalid' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects an oversize processed image', async () => {
    processRecipeImage.mockResolvedValue({ ...processed, full: Buffer.alloc(5 * 1024 * 1024 + 1) });
    expect(await run()).toMatchObject({ ok: false, error: 'image_too_large' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('stores full + thumb under <user>/<recipe>/ in recipe-images and records an imported row with the final URL', async () => {
    expect(await run()).toEqual({ ok: true, data: { id: 'img1' } });
    expect(buckets).toEqual(['recipe-images']);
    const [p1] = upload.mock.calls[0];
    const [p2] = upload.mock.calls[1];
    expect(p1).toMatch(new RegExp(`^u1/${R}/[0-9a-f-]{36}\\.webp$`));
    expect(p2).toBe(p1.replace('.webp', '_t.webp'));
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: 'image/webp', upsert: false });
    expect(inserts[0]).toMatchObject({
      p_recipe_id: R, p_storage_path: p1, p_thumb_path: p2, p_kind: 'imported',
      p_source_url: 'https://cdn.example.com/a.jpg', p_attribution: 'Credit', p_width: 800, p_height: 600,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/recipes/${R}`);
  });

  it('removes the full file when the thumbnail upload fails', async () => {
    upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'x' } });
    expect(await run()).toMatchObject({ ok: false, error: 'generic' });
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
    expect(inserts).toHaveLength(0);
  });

  it('removes both files when the row insert fails and does not revalidate', async () => {
    insertRes = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect(await run()).toMatchObject({ ok: false, error: 'generic' });
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0], upload.mock.calls[1][0]]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('removes both files and reports the quota when the DB refuses the row (limit reached under lock)', async () => {
    insertRes = { data: null, error: null };
    expect(await run()).toMatchObject({ ok: false, error: 'storage_quota_exceeded' });
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0], upload.mock.calls[1][0]]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('uploadAvatar', () => {
  const file = (type = 'image/png', bytes = 10) => new File([new Uint8Array(bytes)], 'a.png', { type });
  const form = (f?: unknown) => {
    const fd = new FormData();
    if (f !== undefined) fd.set('file', f as Blob | string);
    return fd;
  };

  it('rejects unauthenticated callers', async () => {
    getUser.mockResolvedValue(null);
    expect(await uploadAvatar(form(file()))).toMatchObject({ ok: false, error: 'forbidden' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('requires a real file', async () => {
    expect(await uploadAvatar(form())).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await uploadAvatar(form('text'))).toMatchObject({ ok: false, error: 'invalid_input' });
  });

  it('rejects files over the upload limit before any processing', async () => {
    expect(await uploadAvatar(form(file('image/png', 3.5 * 1024 * 1024 + 1)))).toMatchObject({ ok: false, error: 'image_too_large' });
    expect(processAvatar).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the limit', async () => {
    expect(await uploadAvatar(form(file('image/png', 3.5 * 1024 * 1024)))).toMatchObject({ ok: true });
  });

  it('rejects disallowed MIME types (svg, pdf, empty)', async () => {
    for (const t of ['image/svg+xml', 'application/pdf', '']) {
      expect(await uploadAvatar(form(file(t)))).toMatchObject({ ok: false, error: 'invalid_input' });
    }
    expect(processAvatar).not.toHaveBeenCalled();
  });

  it('applies the rate limit', async () => {
    enforceRateLimit.mockRejectedValue(new RateLimitedError('upload_image'));
    expect(await uploadAvatar(form(file()))).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(enforceRateLimit).toHaveBeenCalledWith('upload_image', 'u1');
    expect(upload).not.toHaveBeenCalled();
  });

  it('maps an invalid image to image_invalid', async () => {
    processAvatar.mockRejectedValue(new ImageValidationError('image_invalid'));
    expect(await uploadAvatar(form(file()))).toMatchObject({ ok: false, error: 'image_invalid' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('writes under <user id>/ in the avatars bucket, points the profile at it, then removes the previous file', async () => {
    expect(await uploadAvatar(form(file()))).toEqual({ ok: true, data: undefined });
    expect(buckets[0]).toBe('avatars');
    const path = upload.mock.calls[0][0] as string;
    expect(path).toMatch(/^u1\/[0-9a-f-]{36}\.webp$/);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: 'image/webp', upsert: false });
    expect(profileUpdates).toEqual([{ payload: { avatar_path: path }, eqs: [['id', 'u1']] }]);
    expect(remove).toHaveBeenCalledWith(['u1/old.webp']);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('does not remove anything when there was no previous avatar', async () => {
    rpc.mockResolvedValue({ data: { avatar_path: null } });
    expect(await uploadAvatar(form(file()))).toMatchObject({ ok: true });
    expect(remove).not.toHaveBeenCalled();
  });

  it('fails without touching the profile when the storage upload fails', async () => {
    upload.mockResolvedValue({ error: { message: 'x' } });
    expect(await uploadAvatar(form(file()))).toMatchObject({ ok: false, error: 'generic' });
    expect(profileUpdates).toHaveLength(0);
    expect(remove).not.toHaveBeenCalled();
  });

  it('rolls back the new file and keeps the old one when the profile update fails', async () => {
    profileUpdateRes = { error: { message: 'x' } };
    expect(await uploadAvatar(form(file()))).toMatchObject({ ok: false, error: 'generic' });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
