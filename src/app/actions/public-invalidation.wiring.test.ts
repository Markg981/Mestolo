import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('le azioni che cambiano contenuto pubblico invalidano la pagina pubblica', () => {
  it.each([
    ['ai.ts', 'invalidatePublicPageForRecipe('],
    ['images.ts', 'invalidatePublicPageForRecipe('],
    ['profile.ts', 'invalidateAllPublicPages('],
    ['recipes.ts', 'invalidatePublicPage('],
    ['nutrition.ts', 'invalidatePublicPage('],
    ['settings.ts', 'invalidateAllPublicPages('],
    ['moderation.ts', 'invalidateAllPublicPages('],
  ])('%s chiama %s', (file, call) => {
    expect(read(file)).toContain(call);
  });

  it("nessuna azione usa revalidateTag(..., 'max') per le pagine pubbliche", () => {
    for (const f of ['ai.ts', 'images.ts', 'profile.ts', 'recipes.ts', 'nutrition.ts', 'settings.ts', 'moderation.ts']) {
      expect(read(f)).not.toMatch(/revalidateTag\([^)]*'max'/);
    }
  });
});
