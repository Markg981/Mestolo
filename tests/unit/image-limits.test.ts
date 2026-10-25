import { describe, expect, it } from 'vitest';
import { MAX_IMAGES_PER_USER, MAX_PROCESSED_BYTES, MAX_UPLOAD_BYTES, isAllowedUploadType, isOverImageQuota } from '@/lib/images/limits';
import { userOverImageQuota } from '@/lib/images/quota';
import { readFileSync } from 'node:fs';

describe('image upload limits', () => {
  it('accepts only image MIME types', () => {
    expect(isAllowedUploadType('image/jpeg')).toBe(true);
    expect(isAllowedUploadType('IMAGE/PNG')).toBe(true);
    expect(isAllowedUploadType('image/svg+xml')).toBe(false);
    expect(isAllowedUploadType('text/html')).toBe(false);
    expect(isAllowedUploadType('')).toBe(false);
  });

  it('keeps the processed size within the upload size', () => {
    expect(MAX_PROCESSED_BYTES).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
  });

  it('enforces the per-user stored image cap', () => {
    expect(isOverImageQuota(MAX_IMAGES_PER_USER - 1)).toBe(false);
    expect(isOverImageQuota(MAX_IMAGES_PER_USER)).toBe(true);
    expect(MAX_IMAGES_PER_USER).toBeGreaterThan(150);
  });

  it('counts recipe images and cook-log photos against the cap', async () => {
    const q = (count: number) => {
      const b: Record<string, unknown> = { then: (res: (v: unknown) => unknown) => res({ count }) };
      b.select = () => b;
      b.eq = () => b;
      b.not = () => b;
      return b;
    };
    const client = (a: number, b: number) => ({ from: (t: string) => q(t === 'recipe_images' ? a : b) }) as never;
    expect(await userOverImageQuota(client(10, 5), 'u')).toBe(false);
    expect(await userOverImageQuota(client(MAX_IMAGES_PER_USER - 5, 5), 'u')).toBe(true);
  });

  it('migration drops client write policies and sets bucket limits matching the code', () => {
    const sql = readFileSync('supabase/migrations/20261022000006_storage_uploads_server_only.sql', 'utf8');
    expect(sql).toContain('drop policy if exists recipe_images_storage_insert');
    expect(sql).toContain(`file_size_limit = ${MAX_PROCESSED_BYTES}`);
  });
});
