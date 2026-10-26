import { describe, expect, it } from 'vitest';
import { createSaveGuard } from '@/components/recipes/editor/convert';

describe('createSaveGuard', () => {
  it('ignora il secondo invio mentre il primo e in corso', async () => {
    const g = createSaveGuard();
    let calls = 0;
    const slow = () => new Promise<{ ok: boolean }>((r) => setTimeout(() => (calls++, r({ ok: true })), 10));
    const [a, b] = await Promise.all([g.run(slow), g.run(slow)]);
    expect(calls).toBe(1);
    expect(a).toEqual({ ok: true });
    expect(b).toBeNull();
  });

  it('resta bloccato dopo un salvataggio riuscito (niente conflict con se stessi)', async () => {
    const g = createSaveGuard();
    await g.run(async () => ({ ok: true }));
    expect(await g.run(async () => ({ ok: true }))).toBeNull();
  });

  it('si sblocca dopo un errore o un throw', async () => {
    const g = createSaveGuard();
    await g.run(async () => ({ ok: false }));
    expect(await g.run(async () => ({ ok: true }))).toEqual({ ok: true });
    const g2 = createSaveGuard();
    await expect(g2.run(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(g2.locked).toBe(false);
  });
});
