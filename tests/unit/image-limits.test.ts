import { describe, expect, it } from 'vitest';
import { MAX_PROCESSED_BYTES, MAX_UPLOAD_BYTES, isAllowedUploadType } from '@/lib/images/limits';
import { readFileSync } from 'node:fs';

describe('image upload limits', () => {
  it('accepts only image MIME types', () => {
    expect(isAllowedUploadType('image/jpeg')).toBe(true);
    expect(isAllowedUploadType('IMAGE/PNG')).toBe(true);
    expect(isAllowedUploadType('image/svg+xml')).toBe(false);
    expect(isAllowedUploadType('text/html')).toBe(false);
    expect(isAllowedUploadType('')).toBe(false);
  });

  it('keeps the upload size below the server action body limit and Vercel 4.5 MB', () => {
    const cfg = readFileSync('next.config.ts', 'utf8');
    const m = /bodySizeLimit:\s*'(\d+)mb'/.exec(cfg);
    expect(m).not.toBeNull();
    const bodyLimit = Number(m![1]) * 1024 * 1024;
    expect(MAX_UPLOAD_BYTES).toBeLessThan(bodyLimit);
    expect(bodyLimit).toBeLessThanOrEqual(4.5 * 1024 * 1024);
  });

  it('migration drops client write policies and sets bucket limits matching the code', () => {
    const sql = readFileSync('supabase/migrations/20261022000006_storage_uploads_server_only.sql', 'utf8');
    expect(sql).toContain('drop policy if exists recipe_images_storage_insert');
    expect(sql).toContain(`file_size_limit = ${MAX_PROCESSED_BYTES}`);
  });
});
