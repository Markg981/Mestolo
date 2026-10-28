import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationsDir = join(root, 'supabase/migrations');

/** Tabelle (create table public.X) con almeno una colonna che referenzia auth.users. */
function tablesWithUserColumns(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    const re = /create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi;
    for (const m of sql.matchAll(re)) {
      const cols: string[] = [];
      for (const line of m[2].split('\n')) {
        const c = /^\s*(\w+)\s+uuid\b.*references auth\.users/i.exec(line);
        if (c) cols.push(c[1]);
      }
      if (cols.length) out.set(m[1], cols);
    }
  }
  return out;
}

function exportedTables(): Set<string> {
  const src = readFileSync(join(root, 'src/app/api/account/export/route.ts'), 'utf8');
  const t = new Set<string>();
  for (const m of src.matchAll(/\b(?:own|paged|chunked)\('(\w+)'/g)) t.add(m[1]);
  // Tabelle lette via RPC dedicata (colonne sensibili escluse lato SQL).
  if (src.includes("rpc('my_profile')")) t.add('profiles');
  if (src.includes("rpc('my_api_keys')")) t.add('user_api_keys');
  if (src.includes("rpc('my_recipe_slug_history')")) t.add('recipe_slug_history');
  return t;
}

/** Esclusioni motivate: tabelle con riferimento a un utente ma non esportate. */
const EXCLUDED: Record<string, string> = {
  daily_action_counts: "contatori tecnici anti-abuso per giorno, nessun dato fornito dall'utente",
  shopping_add_requests: 'cache tecnica di idempotenza delle richieste, derivata da shopping_items (gia esportata)',
};

describe('copertura export account', () => {
  const tables = tablesWithUserColumns();
  const exported = exportedTables();

  it('ogni tabella con colonna utente e esportata o in allowlist motivata', () => {
    expect(tables.size).toBeGreaterThan(10);
    const missing = [...tables.keys()].filter((t) => !exported.has(t) && !(t in EXCLUDED));
    expect(missing).toEqual([]);
  });

  it('include i dati di moderazione', () => {
    expect(exported.has('moderation_cases')).toBe(true);
    expect(exported.has('moderation_notices')).toBe(true);
  });

  it('include traduzioni e storico slug delle ricette', () => {
    expect(exported.has('recipe_translations')).toBe(true);
    expect(exported.has('recipe_slug_history')).toBe(true);
  });

  it("l'allowlist non contiene voci obsolete", () => {
    for (const t of Object.keys(EXCLUDED)) {
      expect(tables.has(t), t).toBe(true);
      expect(exported.has(t), t).toBe(false);
    }
  });
});
