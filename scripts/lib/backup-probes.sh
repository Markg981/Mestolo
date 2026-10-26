#!/usr/bin/env bash
# Query condivisa da backup-db.sh e restore-verify-db.sh: stampa righe "<chiave> <valore>" (separatore spazio).
# Il backup la esegue dentro la transazione dello snapshot, la verifica sul database ripristinato:
# le due uscite devono coincidere riga per riga.
# Tipi di riga: count <tabella> (conteggio), hash <tabella> (md5 del contenuto ordinato), schema <oggetto> (conteggio oggetti).
# Uso: probe_sql with-storage|no-storage   (storage.* non esiste nel target di restore: li conta il dump)

PROBE_COUNT_TABLES="public.recipes public.profiles public.categories auth.users auth.identities"
PROBE_STORAGE_TABLES="storage.buckets storage.objects"
# Tabelle chiave con checksum del contenuto (ogni riga in md5, poi md5 delle righe ordinate)
PROBE_HASH_TABLES="public.recipes public.profiles public.categories auth.users"

# Sessione deterministica: stesso testo per timestamp/float in sorgente e ripristino
export PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c timezone=UTC -c datestyle=ISO,MDY -c extra_float_digits=3 -c intervalstyle=postgres"

probe_sql() {
  local t parts=""
  local counts="$PROBE_COUNT_TABLES"
  [ "${1:-no-storage}" = with-storage ] && counts="$counts $PROBE_STORAGE_TABLES"
  for t in $counts; do
    parts="$parts select 'count $t', count(*)::text from $t union all"
  done
  for t in $PROBE_HASH_TABLES; do
    parts="$parts select 'hash $t', md5(coalesce(string_agg(md5(x::text), '' order by md5(x::text)), '')) from $t x union all"
  done
  cat <<SQL
$parts
select 'schema policies', count(*)::text from pg_policies where schemaname in ('public', 'private')
union all select 'schema triggers public', count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and not t.tgisinternal
union all select 'schema triggers auth', count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'auth' and not t.tgisinternal
union all select 'schema functions', count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname in ('public', 'private')
  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
union all select 'schema indexes', count(*)::text from pg_indexes where schemaname in ('public', 'private')
union all select 'schema constraints', count(*)::text from pg_constraint k join pg_namespace s on s.oid = k.connamespace where s.nspname in ('public', 'private')
union all select 'schema tables', count(*)::text from pg_tables where schemaname in ('public', 'private');
SQL
}
