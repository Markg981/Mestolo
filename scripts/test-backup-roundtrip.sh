#!/usr/bin/env bash
# Round trip del backup senza segreti di produzione: semina un database gia' migrato, esegue
# backup-db.sh, ripristina con restore-verify-db.sh in un database nuovo dello stesso server e
# confronta conteggi esatti, contenuto delle ricette e oggetti di schema (policy, trigger, funzioni).
# Uso: scripts/test-backup-roundtrip.sh <db_url>   (db_url = database con stub Supabase e migrazioni)
set -euo pipefail
src="$1"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
restore_db="restore_check_$$"
# stesso server e parametri, altro database: .../<db>?<params> -> .../<restore_db>?<params>
base="${src%%\?*}"
restore="${base%/*}/$restore_db"
case "$src" in *\?*) restore="${restore}?${src#*\?}" ;; esac
# Coppia di chiavi gpg effimera: il backup usa la sola pubblica, il restore la privata
gpg_home="$tmp/gnupg"; mkdir -m 700 "$gpg_home"
GNUPGHOME="$gpg_home" gpg --batch --quiet --pinentry-mode loopback --passphrase '' \
  --quick-generate-key "roundtrip@mestolo.invalid" default default never
BACKUP_GPG_PUBLIC_KEY="$(GNUPGHOME="$gpg_home" gpg --armor --export)"
BACKUP_GPG_PRIVATE_KEY="$(GNUPGHOME="$gpg_home" gpg --batch --pinentry-mode loopback --passphrase '' --armor --export-secret-keys)"
export BACKUP_GPG_PUBLIC_KEY BACKUP_GPG_PRIVATE_KEY

cleanup() {
  psql "$src" -q -c "drop database if exists $restore_db" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

# Dati di prova: utenti (con profilo dal trigger), identita', ricette con ingredienti, metadati storage
psql "$src" -q -v ON_ERROR_STOP=1 <<'SQL'
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null
);
with u as (
  insert into auth.users (email, raw_user_meta_data)
  select 'bk' || g || '_' || md5(random()::text) || '@example.test', jsonb_build_object('username', 'bk' || g || '_' || substr(md5(random()::text), 1, 6))
  from generate_series(1, 12) g returning id
), i as (insert into auth.identities (user_id, provider) select id, 'email' from u)
insert into public.recipes (owner_id, title, visibility, ingredients, tags)
select id, 'Backup ' || n, 'public', jsonb_build_array(jsonb_build_object('name', 'farina', 'quantity', n, 'unit', 'g')), array['backup']
from u cross join generate_series(1, 3) n;
insert into storage.buckets (id, name) values ('recipe-images', 'recipe-images') on conflict do nothing;
insert into storage.objects (bucket_id, name) select 'recipe-images', 'bk/' || md5(random()::text) || '.webp' from generate_series(1, 7);
insert into storage.buckets (id, name) values ('avatars', 'avatars') on conflict do nothing;
insert into storage.objects (bucket_id, name) select 'avatars', 'bk/' || md5(random()::text) || '.webp' from generate_series(1, 5);
SQL

stamp="$("$here/backup-db.sh" "$src" "$tmp/out")"
psql "$src" -q -c "drop database if exists $restore_db" -c "create database $restore_db"
"$here/restore-verify-db.sh" "$tmp/out/backup-$stamp.tar.gpg" "$restore" "$tmp/work"

# Contenuto e schema: identici tra sorgente e ripristino
probe="select
  (select md5(string_agg(id::text || owner_id::text || title || ingredients::text || array_to_string(tags, ','), '|' order by id)) from public.recipes),
  (select count(*) from pg_policies where schemaname in ('public', 'private')),
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and not t.tgisinternal),
  (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname in ('public', 'private')
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')),
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'auth' and not t.tgisinternal),
  (select count(*) from pg_indexes where schemaname = 'public'),
  (select count(*) from pg_constraint k join pg_namespace s on s.oid = k.connamespace where s.nspname = 'public')"
a="$(psql "$src" -At -c "$probe")"
b="$(psql "$restore" -At -c "$probe")"
echo "sorgente:   $a"
echo "ripristino: $b"
if [ "$a" != "$b" ]; then echo "::error::il ripristino differisce dalla sorgente (ricette|policy|trigger|funzioni|trigger auth|indici|vincoli)"; exit 1; fi
g="$(psql "$restore" -At -c "select has_schema_privilege('authenticated', 'private', 'usage') and has_function_privilege('authenticated', 'private.is_blocked_between(uuid, uuid)', 'execute')")"
if [ "$g" != t ]; then echo "::error::authenticated senza grant su private.is_blocked_between dopo il restore"; exit 1; fi
echo "Round trip del backup OK ($stamp)"
