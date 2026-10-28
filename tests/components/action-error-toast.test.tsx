// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ActionErrorToast } from '@/components/ActionErrorToast';
import { ACTION_ERROR_EVENT } from '@/lib/run-action';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => (k === 'close' ? 'Chiudi' : k),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<ActionErrorToast />));
  act(() => {
    window.dispatchEvent(new Event(ACTION_ERROR_EVENT));
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe('ActionErrorToast', () => {
  it('si chiude da solo dopo 6 secondi', () => {
    mount();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(6100));
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('ha un pulsante di chiusura con aria-label che lo chiude', () => {
    mount();
    const btn = document.querySelector('button[aria-label="Chiudi"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    act(() => btn.click());
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('sospende il timer su hover e lo riprende all uscita', () => {
    mount();
    const alert = document.querySelector('[role="alert"]') as HTMLElement;
    act(() => {
      alert.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(20000));
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    act(() => {
      alert.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(6100));
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('sospende il timer quando il pulsante ha il focus', () => {
    mount();
    const btn = document.querySelector('button') as HTMLButtonElement;
    act(() => btn.focus());
    act(() => vi.advanceTimersByTime(20000));
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });
});
