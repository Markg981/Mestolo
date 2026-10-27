import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Se public/sw.js cambia rispetto a origin/main ma VERSION no, i client restano con le cache statiche vecchie.
function gitShow(ref: string): string | null {
  try {
    return execFileSync('git', ['show', ref], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

const version = (src: string) => /const VERSION = '([^']+)'/.exec(src)?.[1];
const body = (src: string) => src.replace(/const VERSION = '[^']+'/, '').replace(/\r\n/g, '\n');

describe('service worker VERSION', () => {
  // null se origin/main non e' disponibile (es. clone shallow): il confronto viene saltato
  const base = gitShow('origin/main:public/sw.js');
  const working = readFileSync('public/sw.js', 'utf8');

  it('e definita', () => {
    expect(version(working)).toBeTruthy();
  });

  it.skipIf(base === null)('cambia se sw.js cambia rispetto a origin/main', () => {
    if (body(working) !== body(base as string)) {
      expect(version(working), 'public/sw.js e cambiato: incrementa VERSION').not.toBe(version(base as string));
    }
  });
});
