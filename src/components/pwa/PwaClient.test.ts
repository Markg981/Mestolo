import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLocalUserData } from './PwaClient';

describe('clearLocalUserData', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('svuota bozze e cache private del service worker (logout ed eliminazione account)', async () => {
    const removed: string[] = [];
    const postMessage = vi.fn();
    vi.stubGlobal('window', { caches: {} });
    vi.stubGlobal('navigator', { serviceWorker: { controller: { postMessage } } });
    vi.stubGlobal('caches', {
      keys: async () => ['mestolo-user-abc', 'mestolo-user', 'mestolo-static'],
      delete: async (n: string) => {
        removed.push(n);
        return true;
      },
    });
    await clearLocalUserData();
    expect(postMessage).toHaveBeenCalledWith({ type: 'clear-user-data' });
    expect(removed.sort()).toEqual(['mestolo-user', 'mestolo-user-abc']);
  });
});
