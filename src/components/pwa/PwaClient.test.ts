import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLocalUserData, handleSignOutSubmit } from './PwaClient';

describe('handleSignOutSubmit', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offline annulla il logout e non cancella i dati locali', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { onLine: false, serviceWorker: { controller: { postMessage } } });
    const preventDefault = vi.fn();
    const onOffline = vi.fn();
    handleSignOutSubmit({ preventDefault }, onOffline);
    expect(preventDefault).toHaveBeenCalled();
    expect(onOffline).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('online lascia proseguire il logout e pulisce i dati locali', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: { postMessage } } });
    const preventDefault = vi.fn();
    handleSignOutSubmit({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ type: 'clear-user-data' });
  });
});

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
