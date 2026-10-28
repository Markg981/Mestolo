#!/usr/bin/env bash
# Query condivisa da backup-db.sh e restore-verify-db.sh: stampa righe "<chiave> <valore>" (separatore spazio).
# Il backup la esegue dentro la transazione dello snapshot, la verifica sul database ripristinato:
# le due uscite devono coincidere riga per riga.
# Tipi di riga: count <tabella> (conteggio), hash <tabella> (md5 del contenuto ordinato), schema <oggetto> (conteggio oggetti).
# Uso: probe_sql with-storage|no-storage   (storage.* non esiste nel target di restore: li conta il dump)

# Tabelle sonda scoperte DINAMICAMENTE da pg_class (F-02): tutte le tabelle ordinarie/partizionate di
# public e private (schemi interi nel dump) piu' le sole tabelle auth presenti nel dump utenti.
# Per ognuna: conteggio righe e md5 del contenuto ordinato (ogni riga in md5, poi md5 delle righe ordinate).
# Una tabella aggiunta da una migrazione e' coperta senza toccare questo file.
PROBE_AUTH_TABLES="users identities"
PROBE_STORAGE_TABLES="storage.buckets storage.objects"

# Sessione deterministica: stesso testo per timestamp/float in sorgente e ripristino
export PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c timezone=UTC -c datestyle=ISO,MDY -c extra_float_digits=3 -c intervalstyle=postgres"

probe_sql() {
  local t storage="" auth_in
  if [ "${1:-no-storage}" = with-storage ]; then
    for t in $PROBE_STORAGE_TABLES; do
      storage="$storage select 'count $t', count(*)::text from $t union all"
    done
  fi
  auth_in="$(printf "'%s'," $PROBE_AUTH_TABLES)"; auth_in="${auth_in%,}"
  # query_to_xml esegue SQL dinamico dentro una SELECT; xpath estrae il valore
  cat <<SQL
with probe_tables as (
  select n.nspname as s, c.relname as t
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and not c.relispartition
    and (n.nspname in ('public', 'private') or (n.nspname = 'auth' and c.relname in ($auth_in)))
    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
)
select 'count ' || s || '.' || t,
  (xpath('/row/v/text()', query_to_xml(format('select count(*) as v from %I.%I', s, t), false, true, '')))[1]::text
from probe_tables
union all
select 'hash ' || s || '.' || t,
  (xpath('/row/v/text()', query_to_xml(format('select md5(coalesce(string_agg(md5(x::text), %L order by md5(x::text)), %L)) as v from %I.%I x', '', '', s, t), false, true, '')))[1]::text
from probe_tables
union all
$storage
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
