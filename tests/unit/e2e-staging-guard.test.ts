import { describe, expect, it } from 'vitest';
import { checkNonE2eUsers, checkSupabaseTarget, MAX_NON_E2E_USERS } from '../../e2e/staging-guard';

describe('checkSupabaseTarget', () => {
  it('accetta lo staging con ref coincidente', () => {
    expect(checkSupabaseTarget('https://abcd1234.supabase.co', 'abcd1234').ok).toBe(true);
    expect(checkSupabaseTarget('https://abcd1234.supabase.co/', ' ABCD1234 ').ok).toBe(true);
  });
  it('rifiuta un progetto con ref diverso (produzione)', () => {
    expect(checkSupabaseTarget('https://prodref99.supabase.co', 'abcd1234').ok).toBe(false);
  });
  it('rifiuta se il ref atteso manca', () => {
    expect(checkSupabaseTarget('https://abcd1234.supabase.co', undefined).ok).toBe(false);
    expect(checkSupabaseTarget('https://abcd1234.supabase.co', '  ').ok).toBe(false);
  });
  it('non si fa ingannare da host che contengono il ref', () => {
    expect(checkSupabaseTarget('https://abcd1234.supabase.co.evil.com', 'abcd1234').ok).toBe(false);
    expect(checkSupabaseTarget('https://evil.com/abcd1234.supabase.co', 'abcd1234').ok).toBe(false);
  });
  it('ammette Supabase locale senza ref', () => {
    expect(checkSupabaseTarget('http://127.0.0.1:54321', undefined).ok).toBe(true);
    expect(checkSupabaseTarget('http://localhost:54321', undefined).ok).toBe(true);
  });
  it('rifiuta URL non validi o host estranei', () => {
    expect(checkSupabaseTarget('non-un-url', 'x').ok).toBe(false);
    expect(checkSupabaseTarget('https://db.example.com', 'x').ok).toBe(false);
  });
});

describe('checkNonE2eUsers', () => {
  it('ammette fino alla soglia e rifiuta oltre', () => {
    expect(checkNonE2eUsers(0).ok).toBe(true);
    expect(checkNonE2eUsers(MAX_NON_E2E_USERS).ok).toBe(true);
    expect(checkNonE2eUsers(MAX_NON_E2E_USERS + 1).ok).toBe(false);
    expect(checkNonE2eUsers(10, 5).ok).toBe(false);
  });
});
