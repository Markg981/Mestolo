#!/usr/bin/env bash
# Verifica un backup di backup-db.sh: lo decifra, lo ripristina su un database vuoto e confronta
# i conteggi con il manifest (tolleranza 2%, min 5 righe: i dump per schema non condividono lo snapshot).
# I metadati storage si contano nel dump: le tabelle storage reali di Supabase non esistono nel target.
# Uso: BACKUP_PASSPHRASE=... scripts/restore-verify-db.sh <backup.tar.gpg> <target_url> <work_dir>
set -uo pipefail
backup="$1"
target="$2"
work="$3"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE richiesto}"

umask 077
mkdir -p "$work"
set -e
gpg --batch --pinentry-mode loopback --passphrase-fd 3 --output "$work/backup.tar" --decrypt "$backup" 3<<<"$BACKUP_PASSPHRASE"
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

# Errori non bloccanti (ruoli/estensioni Supabase) sono attesi: l'esito si decide sui conteggi
# Ordine: auth (tabelle, dati, PK per le FK di public), poi public, poi di nuovo solo i trigger auth:
# chiamano funzioni di public (on_auth_user_created -> public.handle_new_user) e al primo giro falliscono
auth_dump=("$work"/auth-*.dump)
pg_restore --no-owner --no-privileges --dbname "$target" "${auth_dump[@]}" 2>"$work/auth-restore.log" || true
pg_restore --no-owner --no-privileges --dbname "$target" "$work"/public-*.dump || echo "::warning::pg_restore public con errori"
pg_restore -l "${auth_dump[@]}" | awk '$4 == "TRIGGER"' > "$work/auth-triggers.list"
if [ -s "$work/auth-triggers.list" ]; then
  pg_restore --no-owner --no-privileges -L "$work/auth-triggers.list" --dbname "$target" "${auth_dump[@]}" || echo "::warning::pg_restore trigger auth con errori"
fi

# Righe di una tabella nel dump dati dei metadati storage (blocco COPY ... \.)
dump_rows() {
  pg_restore --data-only --file=- "$work"/storage-meta-*.dump | awk -v t="COPY $1 " 'index($0, t) == 1 { on = 1; next } on && $0 == "\\." { on = 0 } on { n++ } END { print n + 0 }'
}

fail=0
while read -r table expected; do
  case "$table" in
    storage.*) actual="$(dump_rows "$table")" ;;
    *) actual="$(psql "$target" -At -c "select count(*) from $table" 2>/dev/null || echo ERR)" ;;
  esac
  if [ "$actual" = "ERR" ]; then
    echo "::error::$table: tabella non ripristinata (atteso $expected)"; fail=1; continue
  fi
  echo "$table atteso=$expected ripristinato=$actual"
  case "$table" in public.recipes|public.profiles|auth.users)
    if [ "$actual" -le 0 ]; then echo "::error::$table vuota dopo il restore"; fail=1; fi ;;
  esac
  tol=$(( expected / 50 )); [ "$tol" -lt 5 ] && tol=5
  # RESTORE_EXACT=1: sorgente ferma (test di round trip), i conteggi devono coincidere
  [ "${RESTORE_EXACT:-0}" = 1 ] && tol=0
  diff=$(( actual > expected ? actual - expected : expected - actual ))
  if [ "$diff" -gt "$tol" ]; then echo "::error::$table: conteggio $actual diverso dal manifest $expected"; fail=1; fi
done < <(cat "$work"/manifest-*.txt)
exit $fail
