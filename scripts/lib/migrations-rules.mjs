// Regole pure per il controllo delle migrazioni (testate in tests/unit/migrations-rules.test.ts).
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Pratiche pericolose vietate nelle migrazioni NUOVE (B-08): "disable trigger" prende un lock
// ACCESS EXCLUSIVE sulla tabella e salta tutti i trigger (integrita', audit, RLS-helper);
// session_replication_role = replica fa lo stesso per l'intera sessione; "disable row level
// security" spegne le policy. Le migrazioni gia' pubblicate non si modificano: le eccezioni
// storiche (20261104000003, 20261104000047) sono gia' su base e non vengono controllate.
// Eccezione nuova e motivata: aggiungere il nome file a DANGEROUS_SQL_ALLOWLIST.
export const DANGEROUS_SQL_ALLOWLIST = [];
export const DANGEROUS_SQL_RULES = [
  { re: /\bdisable\s+trigger\b/i, msg: 'disable trigger (lock esclusivo e salto di tutti i trigger)' },
  { re: /\bsession_replication_role\b/i, msg: 'session_replication_role (disattiva i trigger della sessione)' },
  { re: /\bdisable\s+row\s+level\s+security\b/i, msg: 'disable row level security' },
];

// Rimuove i commenti SQL (riga e blocco) per non dare falsi positivi.
export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** Date -> YYYYMMDDHHMMSS (UTC). */
export function formatTs(d) {
  return d.toISOString().replace(/\D/g, '').slice(0, 14);
}

/** Tetto per le NUOVE migrazioni = max(oggi + 1 giorno, ultima su base + 1 giorno). */
export function computeCeiling(maxBase, now = new Date()) {
  const candidates = [formatTs(new Date(now.getTime() + DAY_MS))];
  if (maxBase && /^\d{14}$/.test(maxBase)) {
    const y = +maxBase.slice(0, 4), mo = +maxBase.slice(4, 6) - 1, d = +maxBase.slice(6, 8);
    const h = +maxBase.slice(8, 10), mi = +maxBase.slice(10, 12), s = +maxBase.slice(12, 14);
    candidates.push(formatTs(new Date(Date.UTC(y, mo, d, h, mi, s) + DAY_MS)));
  }
  return candidates.sort().at(-1);
}

export function validateMigrations({ current, baseFiles, base = 'origin/main', now = new Date(), contents = {} }) {
  const errors = [];
  for (const f of current) {
    if (!NAME.test(f)) errors.push(`Nome non valido: ${f} (atteso <14 cifre>_<descrizione>.sql)`);
  }
  // Versione duplicata = stesso prefisso numerico (anche se la descrizione differisce).
  const seen = new Map();
  for (const f of current) {
    const m = /^(\d+)_/.exec(f);
    if (!m) continue;
    if (seen.has(m[1])) errors.push(`Versione duplicata ${m[1]}: ${seen.get(m[1])} e ${f}`);
    else seen.set(m[1], f);
  }
  if (baseFiles) {
    const baseSet = new Set(baseFiles);
    const max = baseFiles.filter((f) => NAME.test(f)).map((f) => f.slice(0, 14)).sort().at(-1) ?? '';
    const ceiling = computeCeiling(max, now);
    for (const f of current.filter((f) => !baseSet.has(f) && NAME.test(f))) {
      const ts = f.slice(0, 14);
      const sql = contents[f];
      if (sql != null && !DANGEROUS_SQL_ALLOWLIST.includes(f)) {
        const clean = stripSqlComments(sql);
        for (const { re, msg } of DANGEROUS_SQL_RULES) {
          if (re.test(clean)) errors.push(`${f}: pratica vietata nelle nuove migrazioni: ${msg}.`);
        }
      }
      if (ts <= max) errors.push(`${f}: il timestamp deve essere > ${max} (massimo in ${base}). Rinomina la nuova migrazione.`);
      else if (ts > ceiling) errors.push(`${f}: il timestamp supera il tetto ${ceiling} (max(oggi, massimo in ${base}) + 1 giorno). Usa un timestamp <= tetto.`);
    }
  }
  return errors;
}
