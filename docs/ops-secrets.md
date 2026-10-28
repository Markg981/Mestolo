# Secret dei workflow operativi

I workflow schedulati (`backup.yml`, `restore-verify.yml`, `ops-monitor.yml`, `meal-reminders.yml`) leggono i secret del repository GitHub. Se un secret manca, il primo passo di ogni job (`Preflight secrets`) fallisce SUBITO, prima di `npm ci` o di qualsiasi passo pesante, con un unico messaggio `::error title=Secret mancanti::` che elenca TUTTI i nomi mancanti (mai i valori). I secret li imposta il maintainer: nessun workflow o agente puo' farlo al suo posto.

## Tabella secret -> workflow -> scopo

| Secret (nome in GitHub) | Variabile nel job | Workflow che lo richiedono | Scopo |
| --- | --- | --- | --- |
| `SUPABASE_DB_URL` | `SUPABASE_DB_URL` | `backup.yml`, `ops-monitor.yml` (job `missed-reminders`) | URI Postgres (session pooler, porta 5432) per `pg_dump` e per controllare i promemoria non elaborati |
| `BACKUP_GPG_PUBLIC_KEY` | `BACKUP_GPG_PUBLIC_KEY` | `backup.yml` | Chiave PUBBLICA gpg con cui il dump viene cifrato |
| `BACKUP_GPG_PRIVATE_KEY` | `BACKUP_GPG_PRIVATE_KEY` | `restore-verify.yml` | Chiave PRIVATA (armored, senza passphrase) di una coppia dedicata alla sola verifica del restore |
| `BACKUP_S3_BUCKET` | `BACKUP_S3_BUCKET` | `backup.yml`, `restore-verify.yml`, `ops-monitor.yml` (job `backup-age`) | Bucket S3 compatibile PRIVATO, unica destinazione dei backup |
| `BACKUP_S3_ACCESS_KEY_ID` | `AWS_ACCESS_KEY_ID` | `backup.yml`, `restore-verify.yml`, `ops-monitor.yml` (job `backup-age`) | Access key del bucket |
| `BACKUP_S3_SECRET_ACCESS_KEY` | `AWS_SECRET_ACCESS_KEY` | `backup.yml`, `restore-verify.yml`, `ops-monitor.yml` (job `backup-age`) | Secret key del bucket |
| `BACKUP_S3_ENDPOINT` | `BACKUP_S3_ENDPOINT` | `backup.yml`, `restore-verify.yml`, `ops-monitor.yml` | Endpoint per S3 compatibili (R2, B2, ...). Opzionale: vuoto per AWS S3 |
| `NEXT_PUBLIC_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` | `backup.yml` (salvo `BACKUP_SKIP_STORAGE=true`) | URL del progetto Supabase, per il backup delle immagini |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` | `backup.yml` (salvo `BACKUP_SKIP_STORAGE=true`) | Service role key, per leggere lo storage Supabase |
| `APP_URL` | `APP_URL` | `meal-reminders.yml` | URL pubblico del sito (es. `https://mestolo.vercel.app`) |
| `CRON_SECRET` | `CRON_SECRET` | `meal-reminders.yml` | Stesso valore della variabile `CRON_SECRET` su Vercel (min 16 caratteri) |

Variabili di repository (non secret), opzionali: `BACKUP_SKIP_STORAGE=true` con `BACKUP_SKIP_STORAGE_REASON` (motivazione obbligatoria) per escludere il backup delle immagini; `MEAL_REMINDERS_EXTERNAL_SCHEDULER=true` per disattivare `meal-reminders.yml` se la route e' chiamata da un altro scheduler.

`ops-monitor.yml` (job `recent-success`) e `alert-on-failure.yml` usano solo il `GITHUB_TOKEN` automatico: nessun secret da impostare. Dettagli su backup e restore: `docs/backup.md`.

## Impostare i secret

Da una shell con `gh` autenticato sul repository. Senza `--body`, `gh` chiede il valore in modo interattivo (non resta nella history):

```bash
gh secret set SUPABASE_DB_URL
gh secret set BACKUP_GPG_PUBLIC_KEY
gh secret set BACKUP_GPG_PRIVATE_KEY
gh secret set BACKUP_S3_BUCKET
gh secret set BACKUP_S3_ACCESS_KEY_ID
gh secret set BACKUP_S3_SECRET_ACCESS_KEY
gh secret set BACKUP_S3_ENDPOINT        # solo per S3 compatibili
gh secret set NEXT_PUBLIC_SUPABASE_URL
gh secret set SUPABASE_SERVICE_ROLE_KEY
gh secret set APP_URL
gh secret set CRON_SECRET
```

Per leggere un valore da file senza stamparlo: `gh secret set BACKUP_GPG_PUBLIC_KEY < chiave-pubblica.asc`.

Controllo dei nomi presenti (i valori non sono mai visibili): `gh secret list`.

## Piano di verifica manuale (workflow_dispatch)

Dopo aver impostato i secret, in quest'ordine, aspettando l'esito di ciascun run:

1. `gh workflow run meal-reminders.yml` poi `gh run watch`: deve essere verde (la route risponde 2xx). Se fallisce nel `Preflight secrets`, l'errore elenca i nomi ancora mancanti.
2. `gh workflow run backup.yml`: deve essere verde; controllare nel bucket la presenza di `mestolo/db/...` (e delle immagini, se non escluse).
3. `gh workflow run restore-verify.yml`: richiede almeno un backup su S3 (passo 2); deve essere verde.
4. `gh workflow run ops-monitor.yml`: richiede un backup recente (passo 2) e i run riusciti di Backup, Restore verify e Meal reminders (passi 1-3); deve essere verde.
5. Chiudere a mano la issue `[Alert] ... fallito` aperta in precedenza (es. #306) quando tutti i run sono verdi.

Verifica del preflight (facoltativa): rimuovere temporaneamente un secret NON critico in un fork o su un repository di prova e lanciare il workflow: deve fallire in pochi secondi con un solo `::error::` che elenca tutti i nomi mancanti, senza eseguire `npm ci`.
