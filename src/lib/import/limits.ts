/** Photo import limits (kept below the hosting request-body limit of ~4.5 MB). */
export const MAX_PHOTO_PAGES = 8;
export const MAX_PAGE_BYTES = 3 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

/**
 * Video upload: audio is extracted in the browser (mono 8 kHz, 8-bit WAV = 8 KB/s) so that it fits
 * the hosting request-body limit; 4 MB is about 8 minutes of speech. Never the full video.
 */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 8 * 60;
/** Largest video file the browser is asked to decode for audio extraction. */
export const MAX_VIDEO_FILE_BYTES = 200 * 1024 * 1024;
