// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
let onChange: () => void = () => {};
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({ realtime: { setAuth: () => Promise.resolve() } }),
}));
vi.mock('@/lib/realtime/connect', () => ({
  connectRealtime: (_c: unknown, _n: string, _t: unknown, cb: () => void) => {
    onChange = cb;
    return () => {};
  },
}));

import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh';

function Probe() {
  useRealtimeRefresh('u1', 'http://x', 'key');
  return null;
}

let root: Root;
const setOnline = (v: boolean) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });

beforeEach(async () => {
  vi.useFakeTimers();
  refresh.mockClear();
  setOnline(true);
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useRealtimeRefresh', () => {
  it('online: refresh dopo il debounce', () => {
    onChange();
    vi.advanceTimersByTime(900);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('offline: nessun refresh, parte al ritorno online', () => {
    setOnline(false);
    onChange();
    vi.advanceTimersByTime(900);
    expect(refresh).not.toHaveBeenCalled();
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(900);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('rete persa durante il debounce: refresh annullato e rimandato', () => {
    onChange();
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    vi.advanceTimersByTime(900);
    expect(refresh).not.toHaveBeenCalled();
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(900);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
