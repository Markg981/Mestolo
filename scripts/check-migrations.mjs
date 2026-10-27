// Verifica l'ordinamento delle migrazioni Supabase.
// Le migrazioni nuove (presenti in HEAD ma non nel ref di base) devono avere un
// timestamp strettamente maggiore del massimo gia' presente nel ref di base:
// altrimenti vengono ordinate prima di quelle esistenti e `supabase db push`
// puo' rifiutarle. Le migrazioni gia' pubblicate non si rinominano (romperebbe
// la cronologia supabase_migrations).
// Uso: npm run check:migrations   (ref di base: MIGRATIONS_BASE_REF, default origin/main)
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const DIR = 'supabase/migrations';
const base = process.env.MIGRATIONS_BASE_REF || 'origin/main';
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

const errors = [];
const current = readdirSync(DIR).filter((f) => f.endsWith('.sql'));

for (const f of current) if (!NAME.test(f)) errors.push(`Nome non valido: ${f} (atteso <14 cifre>_<descrizione>.sql)`);

const seen = new Map();
for (const f of current) {
  const ts = f.slice(0, 14);
  if (seen.has(ts)) errors.push(`Timestamp duplicato ${ts}: ${seen.get(ts)} e ${f}`);
  seen.set(ts, f);
}

let baseFiles = null;
try {
  baseFiles = execFileSync('git', ['ls-tree', '--name-only', `${base}:${DIR}/`], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.split('/').pop());
} catch {
  console.warn(`[migrations] Ref di base "${base}" non disponibile: controllo dell'ordine saltato.`);
}

// Immutabilita': file esistenti nel merge-base modificati/cancellati (rinomine = D + A).
// Le migrazioni gia' pubblicate non si modificano: serve una nuova migrazione.
try {
  const mb = execFileSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' }).trim();
  const changed = execFileSync(
    'git',
    ['diff', '--no-renames', '--diff-filter=MD', '--name-status', mb, '--', DIR],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
  for (const line of changed) {
    const [st, file] = line.split('\t');
    errors.push(
      `${file}: migrazione gia' pubblicata ${st === 'D' ? 'cancellata/rinominata' : 'modificata'}. Aggiungi una nuova migrazione invece di cambiare quella esistente.`,
    );
  }
} catch {
  console.warn(
    `[migrations] Merge-base con "${base}" non disponibile (clone shallow? usa fetch-depth: 0 o fetch --unshallow): controllo di immutabilita' saltato.`,
  );
}

if (baseFiles) {
  const baseSet = new Set(baseFiles);
  const max = baseFiles.map((f) => f.slice(0, 14)).sort().at(-1) ?? '';
  for (const f of current.filter((f) => !baseSet.has(f))) {
    if (f.slice(0, 14) <= max) {
      errors.push(`${f}: il timestamp deve essere > ${max} (massimo in ${base}). Rinomina la nuova migrazione.`);
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error(`[migrations] ${e}`);
  process.exit(1);
}
console.log('[migrations] OK');
