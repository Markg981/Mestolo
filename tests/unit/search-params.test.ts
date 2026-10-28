import { describe, expect, it } from 'vitest';
import { SEARCH_RPC_MAX_LIMIT, buildSearchRpcParams } from '@/lib/recipes/search-params';

const base = { q: 'pasta', owner: 'u1', limit: 25 };

describe('buildSearchRpcParams', () => {
  it('porta ordinamento e preferiti dentro l RPC', () => {
    const p = buildSearchRpcParams({ ...base, sort: 'title', favorites: true, owner: null });
    expect(p).toMatchObject({ p_sort: 'title', p_only_favorites: true, p_owner: null, p_limit: 25 });
  });
  it('non supera il tetto reale dell RPC', () => {
    expect(buildSearchRpcParams({ ...base, limit: 1000 }).p_limit).toBe(SEARCH_RPC_MAX_LIMIT);
    expect(buildSearchRpcParams({ ...base, limit: 0 }).p_limit).toBe(1);
  });
  it('traduce il cursore keyset', () => {
    expect(buildSearchRpcParams({ ...base, cursor: { v: 'abc', i: 'id1' } })).toMatchObject({ p_after_value: 'abc', p_after_id: 'id1' });
    const n = buildSearchRpcParams({ ...base, cursor: { v: null, i: 'id1' } });
    expect(n).toMatchObject({ p_after_is_null: true, p_after_id: 'id1' });
    expect(n).not.toHaveProperty('p_after_value');
  });
  it('passa i filtri e tronca la query a 100 caratteri', () => {
    const p = buildSearchRpcParams({ ...base, q: 'x'.repeat(150), category: 'c', tag: 't', review: true });
    expect(p).toMatchObject({ p_category: 'c', p_tag: 't', p_needs_review: true });
    expect((p.p_query as string).length).toBe(100);
  });
});
