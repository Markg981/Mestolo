#!/usr/bin/env bash
# Backup cifrato del database: schema public (schema + dati), auth.users/identities, metadati storage
# (solo dati, non i file) e manifest dei conteggi usato da restore-verify-db.sh.
# Uso: BACKUP_PASSPHRASE=... [PG_BIN=/usr/lib/postgresql/17/bin] scripts/backup-db.sh <db_url> <out_dir>
# Scrive <out_dir>/backup-<stamp>.tar.gpg e stampa lo stamp su stdout (il resto va su stderr).
set -euo pipefail
db="$1"
out="$2"
bin="${PG_BIN:+$PG_BIN/}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE richiesto}"

umask 077
mkdir -p "$out"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
"${bin}pg_dump" "$db" --format=custom --compress=9 --no-owner --no-privileges \
  --schema=public --schema=private --file="$out/public-$stamp.dump"
# Utenti: auth.users e auth.identities (schema + dati) per ripristinare le FK di public
"${bin}pg_dump" "$db" --format=custom --compress=9 --no-owner --no-privileges \
  --table=auth.users --table=auth.identities --file="$out/auth-$stamp.dump"
"${bin}pg_dump" "$db" --format=custom --compress=9 --no-owner --no-privileges --data-only \
  --table=storage.buckets --table=storage.objects --file="$out/storage-meta-$stamp.dump"

# Manifest dei conteggi al momento del backup
: > "$out/manifest-$stamp.txt"
for t in public.recipes public.profiles public.categories auth.users auth.identities storage.buckets storage.objects; do
  echo "$t $("${bin}psql" "$db" -At -c "select count(*) from $t")" >> "$out/manifest-$stamp.txt"
done
while read -r l; do echo "$l" >&2; done < "$out/manifest-$stamp.txt"
# Un backup con zero ricette o zero utenti e quasi certamente rotto
grep -qE '^public.recipes [1-9]' "$out/manifest-$stamp.txt" || { echo "::error::public.recipes vuota: backup sospetto" >&2; exit 1; }
grep -qE '^auth.users [1-9]' "$out/manifest-$stamp.txt" || { echo "::error::auth.users vuota: backup sospetto" >&2; exit 1; }

tar -cf "$out/backup-$stamp.tar" -C "$out" "public-$stamp.dump" "auth-$stamp.dump" "storage-meta-$stamp.dump" "manifest-$stamp.txt"
gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 \
  --passphrase-fd 3 --output "$out/backup-$stamp.tar.gpg" "$out/backup-$stamp.tar" 3<<<"$BACKUP_PASSPHRASE"
rm -f "$out"/*.dump "$out"/*.tar "$out"/*.txt
echo "$stamp"
