import { describe, expect, it, vi } from 'vitest';
import { runAction } from '@/lib/run-action';

describe('runAction', () => {
  it('ritorna true e non segnala errori se fn riesce', async () => {
    const onError = vi.fn();
    await expect(runAction(async () => 1, onError)).resolves.toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('cattura il rifiuto, lo segnala e ritorna false senza rilanciare', async () => {
    const onError = vi.fn();
    const err = new Error('Failed to fetch');
    await expect(
      runAction(async () => {
        throw err;
      }, onError),
    ).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('cattura anche le eccezioni sincrone', async () => {
    const onError = vi.fn();
    await expect(
      runAction(() => {
        throw new Error('x');
      }, onError),
    ).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
