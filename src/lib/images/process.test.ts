import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ImageValidationError, prepareOcrPage } from './process';

async function solidPng(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#808080' } }).png({ compressionLevel: 9 }).toBuffer();
}

describe('prepareOcrPage', () => {
  it("rifiuta un'immagine oltre il limite di pixel", async () => {
    const big = await solidPng(8000, 8000); // 64M pixel > 60M
    await expect(prepareOcrPage(big)).rejects.toMatchObject({ code: 'image_invalid' });
    await expect(prepareOcrPage(big)).rejects.toBeInstanceOf(ImageValidationError);
  });

  it('tratta una GIF animata come singolo frame', async () => {
    const frames = await Promise.all(['#ff0000', '#00ff00', '#0000ff'].map((c) => sharp({ create: { width: 40, height: 30, channels: 3, background: c } }).png().toBuffer()));
    const animated = await sharp(frames, { join: { animated: true } }).gif().toBuffer();
    expect((await sharp(animated, { pages: -1 }).metadata()).pages).toBe(3);
    const out = await prepareOcrPage(animated);
    const meta = await sharp(out, { pages: -1 }).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.pages ?? 1).toBe(1);
    expect(meta.height).toBe(30);
  });
});
