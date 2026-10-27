import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regressione audit: un GET /share?url= non deve avviare l'import da solo (simil-CSRF).
describe('share: import solo dopo conferma', () => {
  const src = readFileSync('src/app/(app)/import/link/LinkImport.tsx', 'utf8');
  it('non avvia run() in automatico dall\'URL iniziale', () => {
    expect(src).not.toMatch(/useEffect/);
    expect(src).not.toMatch(/run\(initialUrl\)/);
  });
  it('mostra il messaggio di conferma per il link condiviso', () => {
    expect(src).toContain("t('sharedConfirm')");
  });
});
