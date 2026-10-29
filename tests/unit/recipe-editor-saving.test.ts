import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// E-11: durante il salvataggio l'intero form dell'editor deve essere disabilitato.
describe('RecipeEditor durante il salvataggio', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/recipes/editor/RecipeEditor.tsx'), 'utf8');

  it('avvolge i campi in un fieldset disabilitato e aria-busy quando saving', () => {
    expect(src).toMatch(/<fieldset disabled=\{saving\} aria-busy=\{saving\}/);
  });

  it('chiude il fieldset prima dell aside', () => {
    // \r? perche' su Windows con core.autocrlf il sorgente ha fine riga CRLF.
    expect(src).toMatch(/<\/fieldset>\r?\n {6}\{aside/);
  });
});
