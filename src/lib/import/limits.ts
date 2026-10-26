/**
 * Limite del body delle Server Actions (next.config.ts, serverActions.bodySizeLimit = '4mb').
 * Deve restare allineato a next.config.ts (verificato da un test) e sotto il limite Vercel di ~4,5 MB.
 */
export const BODY_SIZE_LIMIT_BYTES = 4 * 1024 * 1024;
/** Margine per overhead multipart (boundary, header dei campi) e campi non-file della form. */
export const MULTIPART_MARGIN_BYTES = 512 * 1024;

/** Limiti foto: totale foto + margine multipart devono stare nel body limit. */
export const MAX_PHOTO_PAGES = 8;
export const MAX_PAGE_BYTES = 3 * 1024 * 1024;
export const MAX_TOTAL_BYTES = BODY_SIZE_LIMIT_BYTES - MULTIPART_MARGIN_BYTES;

/**
 * Video upload: audio is extracted in the browser (mono 8 kHz, 8-bit WAV = 8 KB/s) so that it fits
 * the hosting request-body limit; 4 MB is about 8 minutes of speech. Never the full video.
 */
export const MAX_AUDIO_BYTES = BODY_SIZE_LIMIT_BYTES - MULTIPART_MARGIN_BYTES;
export const MAX_AUDIO_SECONDS = 8 * 60;
/** Largest video file the browser is asked to decode for audio extraction. */
export const MAX_VIDEO_FILE_BYTES = 200 * 1024 * 1024;
