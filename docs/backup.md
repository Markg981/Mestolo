# Backup e restore

Il workflow `.github/workflows/backup.yml` gira ogni giorno alle 03:17 UTC (e a mano da Actions, "Run workflow").

## Cosa viene salvato

- `public-<ts>.dump`: schema `public` (tabelle, funzioni, trigger, policy RLS) e dati, `pg_dump` 17 in formato custom.
- `auth-<ts>.dump`: tabelle `auth.users` e `auth.identities` (schema + dati, incluso hash password: restano cifrate nel tar.gpg).
- `manifest-<ts>.txt`: righe `<tipo> <nome> <valore>` calcolate nello stesso snapshot dei dump: `count` (conteggio esatto righe), `hash` (md5 del contenuto ordinato di `recipes`, `profiles`, `categories`, `auth.users`) e `schema` (numero di policy, trigger, funzioni, indici, vincoli, tabelle). Usato dalla verifica di restore.
- `storage-meta-<ts>.dump`: solo dati di `storage.buckets` e `storage.objects` (metadati, non i file).
- `storage-<ts>.tar.gpg`: i file dei bucket `recipe-images` (ricette e foto del diario) e `avatars`, scaricati (elenco modificabile con `BACKUP_BUCKETS`) con `scripts/backup-storage.mjs`, piu `storage-manifest.json` (bucket, percorso, dimensione, sha256 di ogni file). Richiede `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`; se mancano il workflow FALLISCE con `::error::`, salvo opt-out esplicito con la variabile di repository `BACKUP_SKIP_STORAGE=true` (Settings > Secrets and variables > Actions > Variables).

## Snapshot consistente

`scripts/backup-db.sh` apre una sessione `psql` dedicata con una transazione `REPEATABLE READ` e ne esporta lo snapshot (`pg_export_snapshot`); i tre `pg_dump` usano `--snapshot` e il manifest e calcolato nella stessa transazione. Dump e manifest descrivono quindi lo stesso istante, anche con scritture concorrenti. Funziona con la connessione diretta e con il session pooler (porta 5432); NON con il transaction pooler (6543), dove lo script fallisce con un errore esplicito.

Tutto e cifrato con `gpg --symmetric --cipher-algo AES256` (`BACKUP_PASSPHRASE`) prima di ogni upload. Artifact con retention 7 giorni (la conservazione lunga e su S3; 7 giorni coprono ops-monitor a 36 ore e la verifica settimanale, e riducono l'esposizione dei file cifrati sul repository pubblico); copia su bucket S3 compatibile, obbligatoria su `main` (i run manuali da altri branch possono farne a meno). Il repository e pubblico, quindi gli artifact cifrati sono scaricabili da chiunque: la passphrase deve avere almeno 32 caratteri, altrimenti il workflow fallisce.

## Monitoraggio

`.github/workflows/ops-monitor.yml` gira ogni 6 ore e fallisce se l'artifact `db-backup-*` piu recente ha piu di 36 ore (o non esiste): GitHub invia la notifica di workflow fallito. `restore-verify.yml` verifica ogni lunedi l'artifact piu recente, anche se il suo run e fallito in uno step successivo (es. upload S3).

## Scelte e limiti

- Dell'schema `auth` sono salvate solo `users` e `identities` (bastano per le FK di `public` e per il login con email/OAuth). Sessioni, MFA e refresh token non sono inclusi: gli utenti dovranno riaccedere.
- Ruoli e configurazione del progetto Supabase (secret, provider auth) non sono inclusi: lo schema e le policy vivono in `supabase/migrations`.
- Le immagini sono salvate se i secret per lo storage sono presenti; altrimenti il workflow fallisce (opt-out: `BACKUP_SKIP_STORAGE=true`). Il conteggio dei file storage non e confrontato con `storage.objects`: sono due letture in istanti diversi.
- Gli artifact di GitHub scadono dopo 7 giorni: la conservazione lunga e su S3. La lifecycle policy versionata in `docs/s3-lifecycle.json` (90 giorni su `mestolo/db/` e `mestolo/storage/`) va applicata una tantum al bucket:
  `aws s3api put-bucket-lifecycle-configuration --bucket <BUCKET> --lifecycle-configuration file://docs/s3-lifecycle.json [--endpoint-url <ENDPOINT>]`
  (R2/B2 supportano la stessa API, verificare la compatibilita del provider). `restore-verify.yml` ripristina dalla copia S3 piu recente, con fallback sull'artifact.

## Secret

| Secret | Obbligatorio | Note |
| --- | --- | --- |
| `SUPABASE_DB_URL` | si | URI del session pooler (porta 5432) con password. Se assente il workflow FALLISCE con `::error::` (nessun salto silenzioso) |
| `BACKUP_PASSPHRASE` | si | Almeno 32 caratteri casuali (`openssl rand -base64 32`); conservarla fuori da GitHub (password manager). Senza di essa i backup sono illeggibili |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | si (salvo `BACKUP_SKIP_STORAGE=true`) | Abilitano il backup delle immagini; se mancano il workflow fallisce |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | si su `main` | Copia su S3 compatibile; se mancano il workflow fallisce (l'artifact viene comunque caricato) |
| `BACKUP_S3_ENDPOINT` | no | Endpoint per S3 compatibili (R2, B2, ecc.) |

## Restore

1. Scaricare l'artifact (o l'oggetto S3) e decifrare:
   ```bash
   gpg --output backup.tar --decrypt backup-<ts>.tar.gpg
   tar -xf backup.tar
   ```
2. Creare un nuovo progetto Supabase (stessa major di Postgres) e applicare le migration (`supabase db push`), poi:
   ```bash
   export TARGET_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
   ```
3. Ripristinare gli utenti (`auth-<ts>.dump`, solo dati se `auth.users` esiste gia nel progetto Supabase), poi i dati di `public`:
   ```bash
   pg_restore --data-only --disable-triggers --no-owner --dbname "$TARGET_DB_URL" auth-<ts>.dump
   pg_restore --data-only --disable-triggers --no-owner --dbname "$TARGET_DB_URL" public-<ts>.dump
   ```
   Su un database vuoto, senza migration, si puo ripristinare anche lo schema: `pg_restore --no-owner --no-privileges --clean --if-exists --dbname "$TARGET_DB_URL" public-<ts>.dump` (il dump include anche lo schema `private`). Poiche `--no-privileges` non ripristina i grant, dopo un restore dello schema rieseguire: `grant usage on schema private to authenticated; grant execute on function private.is_blocked_between(uuid, uuid) to authenticated;` (senza, le policy RLS danno "permission denied for schema private").
4. Ripristinare i metadati storage, solo se i bucket `recipe-images` e `avatars` esistono gia (creato dalle migration):
   ```bash
   pg_restore --data-only --disable-triggers --dbname "$TARGET_DB_URL" storage-meta-<ts>.dump
   ```
5. Ripristinare i file: decifrare `storage-<ts>.tar.gpg`, estrarre e caricare ogni file di `recipe-images/` e `avatars/` nello stesso percorso con `supabase-js` (`storage.from(<bucket>).upload(path, file)`) oppure da dashboard.
6. Verificare: conteggio righe delle tabelle principali, apertura di una ricetta con immagine.

## Verifica automatica del restore

Il workflow `.github/workflows/restore-verify.yml` gira ogni lunedi (04:47 UTC) e a mano. Scarica l'ultimo artifact di `backup.yml` riuscito, lo decifra con `BACKUP_PASSPHRASE`, lo ripristina in un Postgres 17 effimero (service container) e confronta in modo ESATTO (nessuna tolleranza) conteggi, checksum del contenuto e conteggi di oggetti di schema con `manifest-<ts>.txt` (`recipes`, `profiles`, `auth.users` devono essere > 0). Poi scarica il backup storage, lo decifra e verifica ogni file (dimensione + sha256) contro `storage-manifest.json` con `scripts/verify-storage-backup.mjs`. Fallisce se manca il backup, il secret, il backup storage (salvo `BACKUP_SKIP_STORAGE=true`) o qualunque valore diverge.

## Provare un restore a mano

Almeno una volta (poi ogni trimestre): scaricare l'ultimo artifact, decifrarlo e ripristinarlo in un Postgres locale o in un progetto Supabase di prova, mai in produzione:

```bash
docker run -d --name restore-test -e POSTGRES_PASSWORD=pw -p 54399:5432 postgres:17
pg_restore --no-owner --no-privileges --dbname postgresql://postgres:pw@localhost:54399/postgres public-<ts>.dump
psql postgresql://postgres:pw@localhost:54399/postgres -c 'select count(*) from recipes'
```

Errori su `auth.users` o sui ruoli Supabase (`authenticated`, `anon`) in un Postgres vuoto sono attesi: creare prima i ruoli o usare un progetto Supabase di prova.
