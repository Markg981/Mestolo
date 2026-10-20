/** Upload limits enforced by the server before writing to the storage bucket. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Max size of a processed file; must match the bucket file_size_limit. */
export const MAX_PROCESSED_BYTES = 5 * 1024 * 1024;

const ALLOWED_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/heic', 'image/heif']);

export function isAllowedUploadType(type: string): boolean {
  return ALLOWED_UPLOAD_TYPES.has(type.toLowerCase());
}
