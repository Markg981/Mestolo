/**
 * Upload limits enforced by the server before writing to the storage bucket.
 * Files reach the server as server-action bodies, which are capped by next.config.ts
 * (serverActions.bodySizeLimit, 4 MB) and by Vercel's ~4.5 MB request limit: stay below
 * both, leaving room for multipart overhead, so the app's own error is shown.
 */
export const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
/** Max size of a processed file; must match the bucket file_size_limit. */
export const MAX_PROCESSED_BYTES = 5 * 1024 * 1024;

/** Per-user cap on stored images (recipe images + cook-log photos); the daily rate limit alone is unbounded over time. */
export const MAX_IMAGES_PER_USER = 2000;

export function isOverImageQuota(storedCount: number): boolean {
  return storedCount >= MAX_IMAGES_PER_USER;
}

const ALLOWED_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/heic', 'image/heif']);

export function isAllowedUploadType(type: string): boolean {
  return ALLOWED_UPLOAD_TYPES.has(type.toLowerCase());
}
