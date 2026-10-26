import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFT_MAX_AGE_MS,
  clearAllDrafts,
  clearLegacyDrafts,
  clearOtherUsersDrafts,
  draftNames,
  draftSet,
  draftStorageKey,
  isLegacyDraftKey,
  parseDraft,
  serializeDraft,
} from '@/lib/drafts';
import { clearUserCache } from '@/components/pwa/PwaClient';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const RID = '33333333-3333-4333-8333-333333333333';

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: store });
});
afterEach(() => vi.unstubAllGlobals());

describe('chiavi delle bozze', () => {
  it('includono l\'id utente, quindi utenti diversi non condividono la bozza', () => {
    expect(draftStorageKey(A, draftNames.new)).toBe(`mestolo:draft:${A}:new`);
    expect(draftStorageKey(A, draftNames.new)).not.toBe(draftStorageKey(B, draftNames.new));
    expect(draftStorageKey(A, draftNames.edit(RID))).toBe(`mestolo:draft:${A}:edit:${RID}`);
    expect(draftStorageKey(A, draftNames.import('link'))).toBe(`mestolo:draft:${A}:import-link`);
    expect(draftStorageKey(A, draftNames.importPending(draftNames.import('photo')))).toBe(`mestolo:draft:${A}:import-photo:pending`);
  });

  it('riconosce le chiavi del vecchio formato', () => {
    expect(isLegacyDraftKey('mestolo:draft:new')).toBe(true);
    expect(isLegacyDraftKey('mestolo:draft:import-text:abc')).toBe(true);
    expect(isLegacyDraftKey(`mestolo:draft:edit:${RID}`)).toBe(true);
    expect(isLegacyDraftKey(`mestolo:draft:${A}:new`)).toBe(false);
    expect(isLegacyDraftKey('altro:chiave')).toBe(false);
  });
});

describe('pulizia', () => {
  beforeEach(() => {
    store.setItem('mestolo:draft:new', 'x');
    store.setItem(`mestolo:draft:edit:${RID}`, 'x');
    store.setItem(draftStorageKey(A, 'new'), 'x');
    store.setItem(draftStorageKey(B, 'import-text:h'), 'x');
    store.setItem('mestolo:unit-system', 'metric');
  });

  it('clearLegacyDrafts rimuove solo le chiavi senza utente', () => {
    clearLegacyDrafts();
    expect(store.getItem('mestolo:draft:new')).toBeNull();
    expect(store.getItem(`mestolo:draft:edit:${RID}`)).toBeNull();
    expect(store.getItem(draftStorageKey(A, 'new'))).toBe('x');
  });

  it('clearAllDrafts rimuove ogni bozza ma non le altre chiavi', () => {
    clearAllDrafts();
    expect(store.length).toBe(1);
    expect(store.getItem('mestolo:unit-system')).toBe('metric');
  });

  it('clearUserCache (logout) cancella tutte le bozze', async () => {
    await clearUserCache();
    expect(store.length).toBe(1);
    expect(store.getItem('mestolo:unit-system')).toBe('metric');
  });

  it('clearUserCache prima del login tiene le bozze (sessione scaduta durante la modifica)', async () => {
    await clearUserCache({ keepDrafts: true });
    expect(store.length).toBe(5);
  });

  it('clearOtherUsersDrafts tiene solo le bozze dell\'utente entrato', () => {
    clearOtherUsersDrafts(A);
    expect(store.getItem(draftStorageKey(A, 'new'))).toBe('x');
    expect(store.getItem(draftStorageKey(B, 'import-text:h'))).toBeNull();
    expect(store.getItem('mestolo:draft:new')).toBeNull();
    expect(store.getItem(`mestolo:draft:edit:${RID}`)).toBeNull();
    expect(store.getItem('mestolo:unit-system')).toBe('metric');
  });
});

describe('bozze stantie', () => {
  const state = { title: 'Torta' };

  it('ripristina una bozza di una ricetta nuova', () => {
    expect(parseDraft(serializeDraft(state, null), {})).toEqual({ status: 'ok', state });
  });

  it('in modifica ripristina solo se la versione del server e\' la stessa', () => {
    const raw = serializeDraft(state, 'hash-1');
    expect(parseDraft(raw, { serverVersion: 'hash-1' })).toEqual({ status: 'ok', state });
    expect(parseDraft(raw, { serverVersion: 'hash-2' })).toEqual({ status: 'stale' });
  });

  it('in modifica una bozza senza hash e\' stantia', () => {
    const legacy = JSON.stringify({ state, at: Date.now() });
    expect(parseDraft(legacy, { serverVersion: 'hash-1' })).toEqual({ status: 'stale' });
    expect(parseDraft(serializeDraft(state, null), { serverVersion: 'hash-1' })).toEqual({ status: 'stale' });
  });

  it('scarta le bozze piu\' vecchie di 7 giorni', () => {
    const raw = serializeDraft(state, null, 1000);
    expect(parseDraft(raw, { now: 1000 + DRAFT_MAX_AGE_MS - 1 }).status).toBe('ok');
    expect(parseDraft(raw, { now: 1000 + DRAFT_MAX_AGE_MS }).status).toBe('stale');
  });

  it('segnala JSON non valido', () => {
    expect(parseDraft('{no', {})).toEqual({ status: 'invalid' });
    expect(parseDraft('null', {})).toEqual({ status: 'invalid' });
  });
});

describe('draftSet', () => {
  it('restituisce true quando la bozza e\' scritta o rimossa', () => {
    expect(draftSet('k', 'v')).toBe(true);
    expect(store.getItem('k')).toBe('v');
    expect(draftSet('k', null)).toBe(true);
    expect(store.getItem('k')).toBeNull();
  });

  it('restituisce false se lo storage e\' pieno o assente, senza lanciare', () => {
    store.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    expect(draftSet('k', 'v')).toBe(false);
    vi.stubGlobal('window', {});
    expect(draftSet('k', 'v')).toBe(false);
  });
});
