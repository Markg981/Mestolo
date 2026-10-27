// Verifica l'ordinamento delle migrazioni Supabase.
// Le migrazioni nuove (presenti in HEAD ma non nel ref di base) devono avere un
// timestamp strettamente maggiore del massimo gia' presente nel ref di base:
// altrimenti vengono ordinate prima di quelle esistenti e `supabase db push`
// puo' rifiutarle. Le migrazioni gia' pubblicate non si rinominano (romperebbe
// la cronologia supabase_migrations).
// Convenzione: le nuove migrazioni hanno timestamp > massimo su base e
// <= tetto = max(oggi, massimo su base) + 1 giorno (YYYYMMDDHHMMSS, UTC): si
// possono aggiungere migrazioni senza far correre i timestamp nel futuro.
// Versioni (prefisso numerico) duplicate tra file sono errore. In CI (CI=true)
// l'assenza del ref di base e' un errore (usa fetch-depth: 0), in locale un warning.
// Regole pure in scripts/lib/migrations-rules.mjs.
// Uso: npm run check:migrations   (ref di base: MIGRATIONS_BASE_REF, default origin/main)
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { validateMigrations } from './lib/migrations-rules.mjs';

const DIR = 'supabase/migrations';
const base = process.env.MIGRATIONS_BASE_REF || 'origin/main';
const IN_CI = Boolean(process.env.CI);

const errors = [];
const current = readdirSync(DIR).filter((f) => f.endsWith('.sql'));

let baseFiles = null;
try {
  baseFiles = execFileSync('git', ['ls-tree', '--name-only', `${base}:${DIR}/`], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.split('/').pop());
} catch {
  const msg = `Ref di base "${base}" non disponibile (in CI usa fetch-depth: 0): controllo dell'ordine saltato.`;
  if (IN_CI) errors.push(msg);
  else console.warn(`[migrations] ${msg}`);
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

errors.push(...validateMigrations({ current, baseFiles, base }));

if (errors.length) {
  for (const e of errors) console.error(`[migrations] ${e}`);
  process.exit(1);
}
console.log('[migrations] OK');
