#!/usr/bin/env bash
# Backup cifrato del database da UNO SNAPSHOT CONSISTENTE: schema public/private (schema + dati),
# auth.users/identities, metadati storage (solo dati, non i file) e manifest (conteggi esatti,
# checksum delle tabelle chiave, conteggi oggetti di schema) usato da restore-verify-db.sh.
#
# Consistenza: una sessione psql tiene aperta una transazione REPEATABLE READ e esporta lo snapshot
# (pg_export_snapshot); i tre pg_dump usano --snapshot e il manifest e' calcolato nella stessa
# transazione, quindi dump e manifest descrivono esattamente lo stesso istante. Funziona con la
# connessione diretta e con il session pooler (porta 5432), perche' la sessione e' dedicata e persistente.
# NON funziona col transaction pooler (porta 6543): lo snapshot esportato non sarebbe visibile ai pg_dump.
#
# Cifratura ASIMMETRICA (gpg --encrypt): servono solo chiavi PUBBLICHE; la privata del titolare sta fuori da GitHub (quella di verifica no: vedi lib/backup-gpg.sh).
#
# Uso: BACKUP_GPG_PUBLIC_KEY=... [PG_BIN=/usr/lib/postgresql/17/bin] scripts/backup-db.sh <db_url> <out_dir>
# Scrive <out_dir>/backup-<stamp>.tar.gpg e stampa lo stamp su stdout (il resto va su stderr).
set -euo pipefail
db="$1"
out="$2"
bin="${PG_BIN:+$PG_BIN/}"
: "${BACKUP_GPG_PUBLIC_KEY:-${BACKUP_GPG_VERIFY_PUBLIC_KEY:?BACKUP_GPG_PUBLIC_KEY richiesto}}"
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/backup-probes.sh
. "$here/lib/backup-probes.sh"
# shellcheck source=lib/backup-gpg.sh
. "$here/lib/backup-gpg.sh"

umask 077
mkdir -p "$out"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

coproc PSQL { "${bin}psql" "$db" -At -F ' ' -q -v ON_ERROR_STOP=1; }
trap 'kill "$PSQL_PID" 2>/dev/null || true' EXIT

# Invia una query alla sessione snapshot e restituisce le righe fino al sentinella
sentinel="__END_$$__"
snap_query() {
  printf '%s\n' "$1" >&"${PSQL[1]}"
  printf "select '%s';\n" "$sentinel" >&"${PSQL[1]}"
  local l
  while IFS= read -r l <&"${PSQL[0]}"; do
    [ "$l" = "$sentinel" ] && return 0
    printf '%s\n' "$l"
  done
  return 1
}

snap_query "begin isolation level repeatable read read only;" >/dev/null
snapshot="$(snap_query "select pg_export_snapshot();")" || true
if [ -z "$snapshot" ]; then
  echo "::error::pg_export_snapshot fallito: serve connessione diretta o session pooler (porta 5432), non il transaction pooler" >&2
  exit 1
fi
echo "Snapshot $snapshot" >&2

dump() { "${bin}pg_dump" "$db" --snapshot="$snapshot" --format=custom --compress=9 --no-owner --no-privileges "$@"; }
dump --schema=public --schema=private --file="$out/public-$stamp.dump"
# Utenti: auth.users e auth.identities (schema + dati) per ripristinare le FK di public
dump --table=auth.users --table=auth.identities --file="$out/auth-$stamp.dump"
dump --data-only --table=storage.buckets --table=storage.objects --file="$out/storage-meta-$stamp.dump"

# Manifest dalla stessa transazione dei dump
snap_query "$(probe_sql with-storage)" > "$out/manifest-$stamp.txt" || true
printf 'commit;\n\\q\n' >&"${PSQL[1]}" || true
wait "$PSQL_PID" 2>/dev/null || true
trap - EXIT

while read -r l; do echo "$l" >&2; done < "$out/manifest-$stamp.txt"
# Manifest completo: conteggi e hash per ogni tabella (dinamici) + 7 conteggi di schema
if [ "$(grep -c . "$out/manifest-$stamp.txt")" -lt 18 ]; then
  echo "::error::manifest incompleto: backup non valido" >&2; exit 1
fi
# Un backup con zero ricette o zero utenti e quasi certamente rotto
grep -qE '^count public.recipes [1-9]' "$out/manifest-$stamp.txt" || { echo "::error::public.recipes vuota: backup sospetto" >&2; exit 1; }
grep -qE '^count auth.users [1-9]' "$out/manifest-$stamp.txt" || { echo "::error::auth.users vuota: backup sospetto" >&2; exit 1; }

tar -cf "$out/backup-$stamp.tar" -C "$out" "public-$stamp.dump" "auth-$stamp.dump" "storage-meta-$stamp.dump" "manifest-$stamp.txt"
backup_encrypt "$out/backup-$stamp.tar" "$out/backup-$stamp.tar.gpg"
rm -f "$out"/*.dump "$out"/*.tar "$out"/*.txt
echo "$stamp"
