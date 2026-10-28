import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// La versione della cache statica non e piu una costante manuale (E-01): deriva dall id build
// scritto in public/sw-build.js da scripts/write-sw-build-id.mjs (prebuild).
describe('service worker: cache legata alla build', () => {
  const sw = readFileSync('public/sw.js', 'utf8');

  it('usa staticCacheName con MESTOLO_BUILD_ID, senza VERSION manuale', () => {
    expect(sw).toMatch(/staticCacheName\(self\.MESTOLO_BUILD_ID\)/);
    expect(sw).not.toMatch(/const VERSION\s*=/);
  });

  it('importa sw-build.js e non chiama skipWaiting in install', () => {
    expect(sw).toContain("importScripts('/sw-build.js')");
    expect(sw).toMatch(/data\.type === 'skip-waiting'/);
  });
});
