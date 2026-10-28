#!/usr/bin/env bash
# Verifica un backup di backup-db.sh: lo decifra, lo ripristina su un database vuoto e confronta
# con il manifest (calcolato nello stesso snapshot dei dump) in modo ESATTO: conteggi righe e checksum del
# contenuto ordinato di OGNI tabella di public/private e auth.users/identities (scoperte dinamicamente), conteggi di oggetti di schema. Qualsiasi differenza o errore di pg_restore fuori allow-list fallisce.
# I metadati storage si contano nel dump: le tabelle storage reali di Supabase non esistono nel target.
# Uso: BACKUP_GPG_PRIVATE_KEY=... (oppure chiave nel portachiavi gpg) scripts/restore-verify-db.sh <backup.tar.gpg> <target_url> <work_dir>
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/backup-probes.sh
. "$here/lib/backup-probes.sh"
backup="$1"
target="$2"
work="$3"
# shellcheck source=lib/backup-gpg.sh
. "$here/lib/backup-gpg.sh"

umask 077
mkdir -p "$work"
set -e
backup_decrypt "$backup" "$work/backup.tar"
tar -xf "$work/backup.tar" -C "$work"

# Ruoli e stub minimi di Supabase (idempotenti: il target puo' stare in un cluster che li ha gia')
psql "$target" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create schema if not exists storage;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select null::text $$;
create extension if not exists pgcrypto;
-- estensioni create dalle migrazioni in public: pg_dump --schema=public non le include
create extension if not exists pg_trgm with schema public;
create extension if not exists unaccent with schema public;
SQL
set +e

# pg_restore BLOCCANTE (F-02): ogni errore e' un fallimento, tranne quelli dell'allow-list qui sotto.
# Sono motivati: il target e' uno stub di Supabase, non Supabase.
#  - schema/estensione gia' presenti: creati dallo stub sopra (create schema/extension if not exists)
#  - solo per il dump auth, primo giro: i trigger chiamano funzioni di public (on_auth_user_created ->
#    public.handle_new_user) che non esistono ancora; vengono ricreati nel terzo giro, che e' bloccante
ALLOW_COMMON='schema "(public|private|auth|storage)" already exists|extension "[^"]+" already exists'
ALLOW_AUTH_FIRST='function public\.[a-z_]+\(.*\) does not exist'
# restore_checked <etichetta> <regex_allow_extra> <argomenti pg_restore...>
restore_checked() {
  local label="$1" extra="$2" log rc errs unexpected
  shift 2
  log="$work/restore-${label// /_}.log"
  pg_restore --no-owner --no-privileges --dbname "$target" "$@" 2>"$log"
  rc=$?
  errs="$(grep -E '^pg_restore: error:' "$log" || true)"
  if [ -n "$errs" ]; then
    unexpected="$(printf '%s\n' "$errs" | grep -Ev "$ALLOW_COMMON${extra:+|$extra}" || true)"
  else
    unexpected=""
  fi
  if [ -n "$unexpected" ]; then
    echo "::error::pg_restore ($label): errori non ammessi dall'allow-list:"; printf '%s\n' "$unexpected"; return 1
  fi
  if [ "$rc" -ne 0 ] && [ -z "$errs" ]; then
    echo "::error::pg_restore ($label): exit $rc senza errori classificabili"; cat "$log"; return 1
  fi
  [ -n "$errs" ] && echo "pg_restore ($label): $(printf '%s\n' "$errs" | wc -l) errori tollerati dall'allow-list"
  return 0
}

# Ordine: auth (tabelle, dati, PK per le FK di public), poi public, poi di nuovo solo i trigger auth
auth_dump=("$work"/auth-*.dump)
restore_checked "auth" "$ALLOW_AUTH_FIRST" "${auth_dump[@]}" || exit 1
restore_checked "public" "" "$work"/public-*.dump || exit 1
# --no-privileges: i grant di private non vengono ripristinati e le policy RLS li richiedono
psql "$target" -q -v ON_ERROR_STOP=1 -c "do \$\$ begin if exists (select 1 from pg_namespace where nspname = 'private') then
  revoke all on schema private from public, anon;
  grant usage on schema private to authenticated;
  revoke execute on function private.is_blocked_between(uuid, uuid) from public, anon;
  grant execute on function private.is_blocked_between(uuid, uuid) to authenticated;
end if; end \$\$" || { echo "::error::grant schema private non applicati"; exit 1; }
pg_restore -l "${auth_dump[@]}" | awk '$4 == "TRIGGER"' > "$work/auth-triggers.list"
if [ -s "$work/auth-triggers.list" ]; then
  restore_checked "auth trigger" "" -L "$work/auth-triggers.list" "${auth_dump[@]}" || exit 1
fi

# Righe di una tabella nel dump dati dei metadati storage (blocco COPY ... \.)
dump_rows() {
  pg_restore --data-only --file=- "$work"/storage-meta-*.dump | awk -v t="COPY $1 " 'index($0, t) == 1 { on = 1; next } on && $0 == "\\." { on = 0 } on { n++ } END { print n + 0 }'
}

# Stesse sonde del backup sul database ripristinato; confronto con il manifest ESATTO, nessuna tolleranza
psql "$target" -At -F ' ' -q -v ON_ERROR_STOP=1 -c "$(probe_sql no-storage)" > "$work/actual.txt" || { echo "::error::sonde sul database ripristinato fallite"; exit 1; }

fail=0
checked=0
while read -r line; do
  [ -z "$line" ] && continue
  # riga = "<tipo> <nome...> <valore>": il valore e' l'ultimo campo
  expected="${line##* }"
  name="${line% *}"
  case "$name" in
    "count storage."*) actual="$(dump_rows "${name#count }")" ;;
    *) actual="$(awk -v k="$name" '{ v = $NF; $NF = ""; sub(/ $/, ""); if ($0 == k) print v }' "$work/actual.txt")" ;;
  esac
  checked=$((checked + 1))
  if [ -z "$actual" ]; then
    echo "::error::$name: non ripristinato (atteso $expected)"; fail=1; continue
  fi
  if [ "$actual" = "$expected" ]; then
    echo "OK   $name = $expected"
  else
    echo "::error::$name: ripristinato $actual, atteso dal manifest $expected"; fail=1
  fi
  case "$name" in "count public.recipes"|"count public.profiles"|"count auth.users")
    if [ "$actual" -le 0 ] 2>/dev/null; then echo "::error::$name vuota dopo il restore"; fail=1; fi ;;
  esac
done < <(cat "$work"/manifest-*.txt)
# Tabelle presenti nel ripristino ma assenti dal manifest (sonde dinamiche: devono coincidere in entrambi i versi)
while read -r line; do
  [ -z "$line" ] && continue
  name="${line% *}"
  case "$name" in count\ *|hash\ *)
    if ! awk -v k="$name" '{ $NF = ""; sub(/ $/, ""); if ($0 == k) f = 1 } END { exit !f }' "$work"/manifest-*.txt; then
      echo "::error::$name presente nel ripristino ma assente dal manifest"; fail=1
    fi ;;
  esac
done < "$work/actual.txt"
if [ "$checked" -lt 18 ]; then echo "::error::manifest con soli $checked controlli (attesi almeno 18)"; fail=1; fi
exit $fail
