import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({
  meta: { format: 'jpeg', width: 100, height: 100 } as Record<string, unknown>,
  decode: vi.fn(),
}));

vi.mock('sharp', () => {
  const chain: Record<string, unknown> = {};
  const fn = () => chain;
  for (const m of ['rotate', 'resize', 'webp', 'jpeg', 'clone']) chain[m] = fn;
  chain.metadata = async () => state.meta;
  chain.toBuffer = async () => {
    state.decode();
    return Buffer.from('x');
  };
  return { default: () => chain };
});

import { processAvatar, processRecipeImage, prepareOcrPage, MAX_INPUT_PIXELS, ImageValidationError } from '@/lib/images/process';

beforeEach(() => state.decode.mockClear());

describe('limite pixel immagini (D-09)', () => {
  it('il tetto e 25 MP', () => {
    expect(MAX_INPUT_PIXELS).toBe(25_000_000);
  });

  it("rifiuta prima della decodifica un'immagine oltre il tetto", async () => {
    state.meta = { format: 'jpeg', width: 6000, height: 5000 }; // 30 MP
    const buf = Buffer.from('x');
    await expect(processRecipeImage(buf)).rejects.toMatchObject({ code: 'image_too_large' });
    await expect(processAvatar(buf)).rejects.toBeInstanceOf(ImageValidationError);
    expect(state.decode).not.toHaveBeenCalled();
  });

  it("accetta un'immagine entro il tetto", async () => {
    state.meta = { format: 'jpeg', width: 4000, height: 6000 }; // 24 MP
    await expect(processAvatar(Buffer.from('x'))).resolves.toBeInstanceOf(Buffer);
    await expect(prepareOcrPage(Buffer.from('x'))).resolves.toBeInstanceOf(Buffer);
    expect(state.decode).toHaveBeenCalled();
  });
});
