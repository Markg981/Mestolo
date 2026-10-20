import { afterEach, describe, expect, it, vi } from 'vitest';
import { REALTIME_TABLES, canRefreshNow, debounce, userFilter } from '@/lib/realtime/helpers';

describe('realtime helpers', () => {
  afterEach(() => vi.useRealTimers());

  it('costruisce il filtro per utente', () => {
    expect(userFilter('owner_id', 'u1')).toBe('owner_id=eq.u1');
    expect(REALTIME_TABLES.map((t) => t.table)).toContain('favorites');
  });

  it('il debounce accorpa una raffica in una sola chiamata', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    d();
    vi.advanceTimersByTime(50);
    d();
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel annulla la chiamata pendente', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });

  it('refresh solo con tab visibile e online', () => {
    expect(canRefreshNow(true, true)).toBe(true);
    expect(canRefreshNow(false, true)).toBe(false);
    expect(canRefreshNow(true, false)).toBe(false);
  });
});
