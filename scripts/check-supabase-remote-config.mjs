// Verifica che le impostazioni auth del progetto Supabase remoto non siano
// divergenti dalla policy attesa (docs/auth-hardening.md).
// Uso: SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... npm run check:supabase-remote
// Senza token lo script salta (exit 0) a meno di REMOTE_CONFIG_STRICT=1. Il token non viene mai stampato.
import { compareAuthConfig, formatDiffs } from './lib/supabase-remote-config.mjs';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const strict = process.env.REMOTE_CONFIG_STRICT === '1';

if (!token || !ref) {
  const msg = 'check-supabase-remote-config: SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF non impostati, controllo saltato.';
  if (strict) {
    console.error(msg);
    process.exit(1);
  }
  console.log(msg);
  process.exit(0);
}

if (!/^[a-z0-9]{10,40}$/.test(ref)) {
  console.error('check-supabase-remote-config: SUPABASE_PROJECT_REF non valido.');
  process.exit(1);
}

let res;
try {
  res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
} catch (e) {
  console.error(`check-supabase-remote-config: richiesta fallita (${e instanceof Error ? e.message : 'errore di rete'}).`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`check-supabase-remote-config: la Management API ha risposto ${res.status}.`);
  process.exit(1);
}

const diffs = compareAuthConfig(await res.json());
if (diffs.length) {
  console.error(`Config auth remota divergente dalla policy (${diffs.length}):\n${formatDiffs(diffs)}`);
  process.exit(1);
}
console.log('Config auth remota allineata alla policy.');
