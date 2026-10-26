/**
 * Bozze locali dell'editor ricette (localStorage).
 * Le chiavi contengono l'id utente, cosi' due account sullo stesso browser non si vedono le bozze;
 * tutte le chiavi `mestolo:draft:*` vengono cancellate al logout (clearUserCache).
 */

export const DRAFT_PREFIX = 'mestolo:draft:';
export const DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nomi logici delle bozze (la chiave completa si ottiene con draftStorageKey). */
export const draftNames = {
  new: 'new',
  edit: (recipeId: string) => `edit:${recipeId}`,
  import: (kind: 'text' | 'photo' | 'link' | 'file') => `import-${kind}`,
  /** import in revisione (il risultato dell'importazione), per riproporlo dopo un ricaricamento */
  importPending: (importName: string) => `${importName}:pending`,
};

export function draftStorageKey(userId: string, name: string): string {
  return `${DRAFT_PREFIX}${userId}:${name}`;
}

/** Chiave nel vecchio formato, senza id utente (`mestolo:draft:new`, `mestolo:draft:edit:<id>`, ...). */
export function isLegacyDraftKey(key: string): boolean {
  if (!key.startsWith(DRAFT_PREFIX)) return false;
  const [first] = key.slice(DRAFT_PREFIX.length).split(':');
  return !UUID_RE.test(first ?? '');
}

export interface StoredDraft<T> {
  state: T;
  at: number;
  /** versione del server (content_hash) da cui e' partita la bozza; null per bozze di ricette nuove/importate */
  base: string | null;
}

export type DraftParseResult<T> = { status: 'ok'; state: T } | { status: 'stale' } | { status: 'invalid' };

/**
 * Valuta una bozza serializzata.
 * Se `serverVersion` e' valorizzato (modifica di una ricetta esistente) la bozza e' valida solo se
 * parte esattamente da quella versione; bozze senza versione sono considerate stantie.
 */
export function parseDraft<T>(raw: string, opts: { serverVersion?: string | null; now?: number }): DraftParseResult<T> {
  let parsed: Partial<StoredDraft<T>> | null;
  try {
    parsed = JSON.parse(raw) as Partial<StoredDraft<T>> | null;
  } catch {
    return { status: 'invalid' };
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.state || typeof parsed.at !== 'number') return { status: 'invalid' };
  if ((opts.now ?? Date.now()) - parsed.at >= DRAFT_MAX_AGE_MS) return { status: 'stale' };
  if (opts.serverVersion != null && parsed.base !== opts.serverVersion) return { status: 'stale' };
  return { status: 'ok', state: parsed.state };
}

export function serializeDraft<T>(state: T, base: string | null | undefined, now = Date.now()): string {
  return JSON.stringify({ state, at: now, base: base ?? null } satisfies StoredDraft<T>);
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function draftGet(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Restituisce false se la bozza non è stata scritta (storage pieno, bloccato o assente). */
export function draftSet(key: string, value: string | null): boolean {
  try {
    const st = storage();
    if (!st) return false;
    if (value === null) st.removeItem(key);
    else st.setItem(key, value);
    return true;
  } catch {
    /* storage non disponibile: la bozza resta in memoria */
    return false;
  }
}

function allDraftKeys(st: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < st.length; i++) {
    const k = st.key(i);
    if (k?.startsWith(DRAFT_PREFIX)) keys.push(k);
  }
  return keys;
}

/** Cancella tutte le bozze (di ogni utente e del vecchio formato). Chiamata al logout. */
export function clearAllDrafts() {
  try {
    const st = storage();
    if (!st) return;
    for (const k of allDraftKeys(st)) st.removeItem(k);
  } catch {
    /* niente da pulire */
  }
}

/** Cancella solo le bozze nel vecchio formato senza id utente (possono appartenere a chiunque). */
export function clearLegacyDrafts() {
  try {
    const st = storage();
    if (!st) return;
    for (const k of allDraftKeys(st)) if (isLegacyDraftKey(k)) st.removeItem(k);
  } catch {
    /* niente da pulire */
  }
}
