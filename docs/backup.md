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

Tutto e cifrato in modo ASIMMETRICO (`gpg --encrypt`, `scripts/lib/backup-gpg.sh`) verso le chiavi PUBBLICHE in `BACKUP_GPG_PUBLIC_KEY` (una o piu, in formato armored concatenate): backup.yml non possiede nessuna chiave o passphrase capace di decifrare. La chiave privata del titolare resta fuori da GitHub (password manager / KMS, con copia offline) e serve al restore. I backup vanno SOLO su bucket S3 compatibile privato (obbligatorio su ogni run) e MAI come artifact di GitHub: il repository e pubblico, gli artifact sono scaricabili da qualunque utente autenticato e il dump contiene `auth.users` e `auth.identities` (hash password, token). `backup.yml` ha uno step che fallisce se compare un upload di artifact e `tests/unit/cron-config.test.ts` lo verifica.

## Monitoraggio

`.github/workflows/ops-monitor.yml` gira ogni 6 ore e fallisce se l'oggetto piu recente in `mestolo/db/` su S3 ha piu di 36 ore (o non esiste): GitHub invia la notifica di workflow fallito. `restore-verify.yml` verifica ogni lunedi la copia S3 piu recente.

## Scelte e limiti

- Dell'schema `auth` sono salvate solo `users` e `identities` (bastano per le FK di `public` e per il login con email/OAuth). Sessioni, MFA e refresh token non sono inclusi: gli utenti dovranno riaccedere.
- Ruoli e configurazione del progetto Supabase (secret, provider auth) non sono inclusi: lo schema e le policy vivono in `supabase/migrations`.
- Le immagini sono salvate se i secret per lo storage sono presenti; altrimenti il workflow fallisce (opt-out: `BACKUP_SKIP_STORAGE=true`). Il conteggio dei file storage non e confrontato con `storage.objects`: sono due letture in istanti diversi.
- La conservazione e solo su S3. La lifecycle policy versionata in `docs/s3-lifecycle.json` (90 giorni su `mestolo/db/` e `mestolo/storage/`) va applicata una tantum al bucket:
  `aws s3api put-bucket-lifecycle-configuration --bucket <BUCKET> --lifecycle-configuration file://docs/s3-lifecycle.json [--endpoint-url <ENDPOINT>]`
  (R2/B2 supportano la stessa API, verificare la compatibilita del provider). `restore-verify.yml` ripristina dalla copia S3 piu recente.

## Secret

| Secret | Obbligatorio | Note |
| --- | --- | --- |
| `SUPABASE_DB_URL` | si | URI del session pooler (porta 5432) con password. Se assente il workflow FALLISCE con `::error::` (nessun salto silenzioso) |
| `BACKUP_GPG_PUBLIC_KEY` | si | Chiavi PUBBLICHE gpg (`gpg --armor --export <id>`): quella del titolare e, per la verifica in CI, quella di una coppia dedicata `restore-verify`. Le private del titolare NON vanno su GitHub |
| `BACKUP_GPG_PRIVATE_KEY` | per `restore-verify.yml` | Privata (armored, senza passphrase) della sola coppia dedicata alla verifica: e l'unico segreto di decifratura su GitHub, abbinato alle credenziali S3, quindi usare una coppia usa-e-getta, mai la chiave del titolare |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | si (salvo `BACKUP_SKIP_STORAGE=true`) | Abilitano il backup delle immagini; se mancano il workflow fallisce |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | si | Bucket S3 compatibile PRIVATO: unica destinazione dei backup; se mancano il workflow fallisce |
| `BACKUP_S3_ENDPOINT` | no | Endpoint per S3 compatibili (R2, B2, ecc.) |

## Restore

1. Scaricare l'oggetto da S3 e decifrare con la chiave privata (importarla prima con `gpg --import`):
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

Il workflow `.github/workflows/restore-verify.yml` gira ogni lunedi (04:47 UTC) e a mano. Scarica da S3 l'ultimo backup, lo decifra con `BACKUP_GPG_PRIVATE_KEY`, lo ripristina in un Postgres 17 effimero (service container) e confronta in modo ESATTO (nessuna tolleranza) conteggi, checksum del contenuto e conteggi di oggetti di schema con `manifest-<ts>.txt` (`recipes`, `profiles`, `auth.users` devono essere > 0). Poi scarica il backup storage, lo decifra e verifica ogni file (dimensione + sha256) contro `storage-manifest.json` con `scripts/verify-storage-backup.mjs`. Fallisce se manca il backup, il secret, il backup storage (salvo `BACKUP_SKIP_STORAGE=true`) o qualunque valore diverge.

## Provare un restore a mano

Almeno una volta (poi ogni trimestre): scaricare l'ultimo oggetto da S3, decifrarlo e ripristinarlo in un Postgres locale o in un progetto Supabase di prova, mai in produzione:

```bash
docker run -d --name restore-test -e POSTGRES_PASSWORD=pw -p 54399:5432 postgres:17
pg_restore --no-owner --no-privileges --dbname postgresql://postgres:pw@localhost:54399/postgres public-<ts>.dump
psql postgresql://postgres:pw@localhost:54399/postgres -c 'select count(*) from recipes'
```

Errori su `auth.users` o sui ruoli Supabase (`authenticated`, `anon`) in un Postgres vuoto sono attesi: creare prima i ruoli o usare un progetto Supabase di prova.
