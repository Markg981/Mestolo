/**
 * Guardie pure contro l'esecuzione degli e2e (service role, cancellazioni) su un progetto
 * Supabase che non sia quello di staging. Nessuna dipendenza: testabile con vitest.
 */

/** Oltre questo numero di utenti non e2e il database non sembra uno staging. */
export const MAX_NON_E2E_USERS = 50;

const HOSTED_HOST = /^([a-z0-9]+)\.supabase\.co$/;

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Verifica l'URL: gli host locali passano, i progetti *.supabase.co solo se il ref coincide con l'allow-list. */
export function checkSupabaseTarget(url: string, expectedRef: string | undefined): GuardResult {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: 'NEXT_PUBLIC_SUPABASE_URL non e un URL valido.' };
  }
  const hosted = HOSTED_HOST.exec(host);
  if (!hosted) {
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return { ok: true };
    return { ok: false, reason: `Host non ammesso per gli e2e (${host}): solo Supabase locale o il progetto di staging.` };
  }
  const ref = expectedRef?.trim().toLowerCase();
  if (!ref) {
    return {
      ok: false,
      reason: 'E2E_SUPABASE_PROJECT_REF e obbligatoria quando l URL e un progetto *.supabase.co (ref dello staging).',
    };
  }
  if (hosted[1] !== ref) {
    return {
      ok: false,
      reason: `Il project ref dell URL (${hosted[1]}) non coincide con E2E_SUPABASE_PROJECT_REF: rifiuto di operare (possibile produzione).`,
    };
  }
  return { ok: true };
}

/** Guardia dati: uno staging contiene pochi utenti reali; un numero alto indica produzione. */
export function checkNonE2eUsers(nonE2eUsers: number, max: number = MAX_NON_E2E_USERS): GuardResult {
  if (nonE2eUsers > max) {
    return {
      ok: false,
      reason: `Il database contiene piu di ${max} utenti non e2e (${nonE2eUsers}): non sembra uno staging, rifiuto di operare.`,
    };
  }
  return { ok: true };
}
