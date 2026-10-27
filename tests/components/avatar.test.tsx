// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Avatar } from '@/components/Avatar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(ui: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('Avatar', () => {
  it("mostra l'iniziale maiuscola senza immagine", () => {
    const el = render(<Avatar userId="u1" name="  marco" />);
    expect(el.textContent).toBe('M');
    expect(el.querySelector('img')).toBeNull();
  });

  it("con hasImage usa /api/avatars/<id> e ricade sull'iniziale se l'immagine fallisce", () => {
    const el = render(<Avatar userId="u1" name="Anna" hasImage />);
    const img = el.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/avatars/u1');
    act(() => {
      img!.dispatchEvent(new Event('error'));
    });
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('A');
  });
});
