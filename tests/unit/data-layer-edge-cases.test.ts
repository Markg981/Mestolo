import { beforeEach, describe, expect, it, vi } from 'vitest';

const tables: Record<string, { data: unknown; count?: number | null }> = {};
let rpcResult: { data: unknown } = { data: null };

function builder(table: string) {
  const b: Record<string, unknown> = {
    then: (r: (v: unknown) => unknown) => Promise.resolve(tables[table] ?? { data: null }).then(r),
    maybeSingle: () => Promise.resolve(rpcResult),
  };
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) b[m] = () => b;
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (t: string) => builder(t), rpc: () => builder('rpc') }),
}));

import { listRecipeCookLogs, listMyCookLogs } from '@/lib/data/cook-logs';
import { getProfileCard, getAuthorCard, visibleAvatarIds } from '@/lib/data/profiles';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  recipe_id: 'r1',
  user_id: 'u1',
  cooked_at: '2026-01-01',
  note: 'ok',
  photo_path: null,
  visibility: 'recipe',
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  rpcResult = { data: null };
});

describe('cook-logs', () => {
  it('nessun dato: lista vuota e count 0, senza interrogare i profili', async () => {
    tables.cook_logs = { data: null, count: null };
    expect(await listRecipeCookLogs('r1')).toEqual({ count: 0, logs: [] });
    expect(await listMyCookLogs('u1')).toEqual([]);
  });
  it('arricchisce con profilo e usa il count esatto', async () => {
    tables.cook_logs = { data: [row({ photo_path: 'p.jpg' }), row({ id: 'l2', user_id: 'u2' })], count: 7 };
    tables.profiles = { data: [{ id: 'u1', username: 'ann', display_name: 'Ann' }] };
    const r = await listRecipeCookLogs('r1');
    expect(r.count).toBe(7);
    expect(r.logs[0]).toMatchObject({ has_photo: true, username: 'ann', displayName: 'Ann' });
    expect(r.logs[1]).toMatchObject({ has_photo: false, username: null, displayName: null });
  });
  it('count ricade sul numero di righe se assente', async () => {
    tables.cook_logs = { data: [row()], count: null };
    tables.profiles = { data: null };
    expect((await listRecipeCookLogs('r1')).count).toBe(1);
  });
  it('storico personale: titolo nullo se la ricetta non e visibile', async () => {
    tables.cook_logs = { data: [row(), row({ id: 'l2', recipe_id: 'r2' })] };
    tables.recipes = { data: [{ id: 'r1', title: 'Pasta' }] };
    const r = await listMyCookLogs('u1');
    expect(r.map((x) => x.recipeTitle)).toEqual(['Pasta', null]);
  });
});

describe('profiles', () => {
  it('getProfileCard: null se assente', async () => {
    expect(await getProfileCard('nobody')).toBeNull();
  });
  it('getAuthorCard: avatar solo se visibile e presente', async () => {
    rpcResult = { data: { id: 'u1', username: 'ann', display_name: 'Ann', can_view: true, avatar_path: 'a.png' } };
    expect(await getAuthorCard('ann')).toEqual({ username: 'ann', displayName: 'Ann', avatarUserId: 'u1' });
    rpcResult = { data: { id: 'u1', username: 'ann', display_name: 'Ann', can_view: false, avatar_path: 'a.png' } };
    expect((await getAuthorCard('ann'))?.avatarUserId).toBeNull();
    rpcResult = { data: null };
    expect(await getAuthorCard('ann')).toBeNull();
  });
  it('visibleAvatarIds: vuoto senza chiamare il DB, altrimenti set degli id', async () => {
    expect((await visibleAvatarIds([])).size).toBe(0);
    tables.rpc = { data: [{ id: 'u1' }, { id: 'u2' }] };
    // rpc() restituisce un builder: then risolve su tables.rpc
    expect([...(await visibleAvatarIds(['u1', 'u2']))]).toEqual(['u1', 'u2']);
  });
});
