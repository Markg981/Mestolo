# Backup e restore

Il workflow `.github/workflows/backup.yml` gira ogni giorno alle 03:17 UTC (e a mano da Actions, "Run workflow").

## Cosa viene salvato

- `public-<ts>.dump`: schema `public` (tabelle, funzioni, trigger, policy RLS) e dati, `pg_dump` 17 in formato custom.
- `storage-meta-<ts>.dump`: solo dati di `storage.buckets` e `storage.objects` (metadati, non i file).
- `storage-<ts>.tar.gpg` (opzionale): i file del bucket `recipe-images`, scaricati con `scripts/backup-storage.mjs`. Richiede `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`; se mancano il passo viene saltato.

Tutto e cifrato con `gpg --symmetric --cipher-algo AES256` (`BACKUP_PASSPHRASE`) prima di ogni upload. Artifact con retention 30 giorni; copia opzionale su bucket S3 compatibile.

## Scelte e limiti

- Lo schema `auth` (utenti, hash password) NON e incluso, per non copiare credenziali. Le tabelle `public` hanno FK verso `auth.users`: per un ripristino completo gli utenti vanno riportati a parte (dump manuale di `auth.users`/`auth.identities` con `--data-only`, solo se serve, conservato con la stessa cifratura) oppure ricreati e rimappati.
- Ruoli e configurazione del progetto Supabase (secret, provider auth) non sono inclusi: lo schema e le policy vivono in `supabase/migrations`.
- Le immagini sono salvate solo se i secret per lo storage sono presenti.
- Gli artifact di GitHub scadono: per una conservazione piu lunga configurare S3.

## Secret

| Secret | Obbligatorio | Note |
| --- | --- | --- |
| `SUPABASE_DB_URL` | si | URI del session pooler (porta 5432) con password. Se assente il workflow salta con una notice |
| `BACKUP_PASSPHRASE` | si | Passphrase lunga e casuale; conservarla fuori da GitHub (password manager). Senza di essa i backup sono illeggibili |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | no | Abilitano il backup delle immagini |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_ENDPOINT` | no | Copia su S3 compatibile (l'endpoint serve per R2, B2, ecc.) |

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
3. Ripristinare gli utenti in `auth.users` se servono, poi i dati di `public`:
   ```bash
   pg_restore --data-only --disable-triggers --no-owner --dbname "$TARGET_DB_URL" public-<ts>.dump
   ```
   Su un database vuoto, senza migration, si puo ripristinare anche lo schema: `pg_restore --no-owner --no-privileges --clean --if-exists --dbname "$TARGET_DB_URL" public-<ts>.dump`.
4. Ripristinare i metadati storage, solo se il bucket `recipe-images` esiste gia (creato dalle migration):
   ```bash
   pg_restore --data-only --disable-triggers --dbname "$TARGET_DB_URL" storage-meta-<ts>.dump
   ```
5. Ripristinare i file: decifrare `storage-<ts>.tar.gpg`, estrarre e caricare ogni file di `recipe-images/` nello stesso percorso con `supabase-js` (`storage.from('recipe-images').upload(path, file)`) oppure da dashboard.
6. Verificare: conteggio righe delle tabelle principali, apertura di una ricetta con immagine.

## Provare un restore

Almeno una volta (poi ogni trimestre): scaricare l'ultimo artifact, decifrarlo e ripristinarlo in un Postgres locale o in un progetto Supabase di prova, mai in produzione:

```bash
docker run -d --name restore-test -e POSTGRES_PASSWORD=pw -p 54399:5432 postgres:17
pg_restore --no-owner --no-privileges --dbname postgresql://postgres:pw@localhost:54399/postgres public-<ts>.dump
psql postgresql://postgres:pw@localhost:54399/postgres -c 'select count(*) from recipes'
```

Errori su `auth.users` o sui ruoli Supabase (`authenticated`, `anon`) in un Postgres vuoto sono attesi: creare prima i ruoli o usare un progetto Supabase di prova.
