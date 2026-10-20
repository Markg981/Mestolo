import 'server-only';
import sharp, { type Metadata } from 'sharp';

export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'heif']);

export class ImageValidationError extends Error {
  constructor(public code: 'image_invalid' | 'image_too_large') {
    super(code);
  }
}

/**
 * Decodes and re-encodes an uploaded image:
 * - verifies it is a real image of an allowed format (magic bytes, not the file name)
 * - applies EXIF orientation (photos taken sideways come out upright)
 * - strips ALL metadata (EXIF/GPS location of photos never reaches storage)
 * - produces a 1600px WebP and a 480px thumbnail for mobile connections
 */
export async function processRecipeImage(input: Buffer) {
  if (input.length > MAX_INPUT_BYTES) throw new ImageValidationError('image_too_large');
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw new ImageValidationError('image_invalid');
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) throw new ImageValidationError('image_invalid');

  const base = sharp(input, { limitInputPixels: 50_000_000, animated: false }).rotate();
  const full = await base.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  const thumb = await base.clone().resize({ width: 480, height: 480, fit: 'cover', position: 'attention' }).webp({ quality: 72 }).toBuffer();
  return { full: full.data, width: full.info.width, height: full.info.height, thumb };
}

/**
 * Normalises a cookbook page photo before sending it to an OCR/vision provider:
 * upright orientation, no metadata, JPEG, longest side 2000px.
 */
export async function prepareOcrPage(input: Buffer): Promise<Buffer> {
  if (input.length > MAX_INPUT_BYTES) throw new ImageValidationError('image_too_large');
  try {
    const meta = await sharp(input).metadata();
    if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) throw new ImageValidationError('image_invalid');
    return await sharp(input, { limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (e) {
    if (e instanceof ImageValidationError) throw e;
    throw new ImageValidationError('image_invalid');
  }
}
