# App Android e iOS (Capacitor) e pubblicazione sugli store

Mestolo è **un solo codice** per tre canali:

| Canale | Cosa usa |
|---|---|
| Web (qualsiasi browser) | il sito Next.js pubblicato |
| Android (Google Play) | app Capacitor in `android/` che carica il sito pubblicato + funzioni native |
| iOS (App Store) | app Capacitor in `ios/` che carica il sito pubblicato + funzioni native |

Le app **non contengono dati né chiavi**: si collegano allo stesso sito e allo stesso Supabase. Ogni correzione pubblicata sul sito arriva subito anche nelle app, senza nuova revisione (salvo modifiche alla parte nativa).

## Cosa aggiunge l'app rispetto al sito

- **Fotocamera nativa** per fotografare le pagine del ricettario (`src/lib/native/camera.ts`).
- **"Condividi → Mestolo"** su Android: un link condiviso da Chrome o da un'altra app apre direttamente l'import da link (`MainActivity.java` → `/share`). Sul web lo stesso funziona con la PWA installata su Android (Web Share Target).
- **Pagina offline locale** (`mobile/www/offline.html`) se il server non è raggiungibile, più le **copie offline** di ricettario, ricette aperte, lista della spesa e piano (service worker `public/sw.js`).
- Icona, splash screen, scorciatoie (PWA), area sicura per notch e barra di sistema.

### Limiti attuali
- **iOS: Share Extension implementata** (`ios/App/ShareExtension/`, target `ShareExtension` nel progetto Xcode, vedi [ios-share-extension.md](ios-share-extension.md)): link e testi condivisi aprono l'import. Le **immagini** condivise vengono salvate nell'App Group ma l'app non le legge ancora.
- **Notifiche** (es. promemoria del piano pasti): non implementate.
- Capacitor documenta il caricamento di un sito remoto (`server.url`) come pensato per lo sviluppo. Funziona ed è usato in produzione da molte app, ma Apple può rifiutare app che considera "solo un sito" (linea guida 4.2): per questo l'app integra funzioni native. Se Apple dovesse rifiutare, le strade sono aggiungere altre funzioni native (notifiche, condivisione iOS, offline più ricco) o, più in là, un frontend nativo che usi le stesse API.

## 1. Prerequisiti

1. **Sito pubblicato in HTTPS** (Vercel + Supabase, vedi README) con `NEXT_PUBLIC_SUPPORT_EMAIL` impostata.
2. In `.env.local` (o come variabili della shell):
   ```env
   CAP_SERVER_URL=https://tuo-dominio.example     # il sito pubblicato
   CAP_APP_ID=com.tuonome.mestolo                  # identificativo univoco, NON cambiarlo dopo la pubblicazione
   ```
   L'`appId` predefinito è `com.markg981.mestolo`: se lo cambi, rinomina anche il package Java in `android/app/src/main/java/...` e il valore in `android/app/build.gradle` (`namespace` e `applicationId`), oppure rigenera le piattaforme (`rm -rf android ios && npx cap add android && npx cap add ios`, poi riapplica le modifiche descritte in fondo).
3. Dopo ogni modifica di questi valori: `npm run mobile:sync`.
4. Icone e splash: `npm run icons` (PWA + sorgenti in `assets/`) e `npm run mobile:assets` (genera le risorse native).

## 2. Provare l'app su un telefono Android (sviluppo)

1. Installa **Android Studio** (include SDK e JDK).
2. Avvia il sito in locale raggiungibile dalla rete: `npm run build && npx next start -H 0.0.0.0 -p 3000`.
3. `CAP_SERVER_URL=http://<IP-del-PC>:3000 npm run mobile:android` (l'HTTP in chiaro viene abilitato solo quando l'indirizzo è http://: mai per le build da store).
4. In Android Studio: collega il telefono con *Debug USB* attivo e premi ▶ *Run*.

## 3. Google Play

1. Account **Google Play Console** (25 $ una tantum). Gli account personali creati dopo novembre 2023 devono fare un **test chiuso con almeno 12 tester per 14 giorni consecutivi** prima di poter pubblicare in produzione: pianificalo.
2. `CAP_SERVER_URL=https://tuo-dominio npm run mobile:android`.
3. Android Studio → *Build → Generate Signed App Bundle* → crea una **keystore** (conservala insieme alla password fuori dal repository: senza non potrai più aggiornare l'app; i file `*.jks`/`*.keystore` sono già in `.gitignore`). Consigliato: attivare *Play App Signing*.
4. Aggiorna `versionCode` (intero crescente) e `versionName` in `android/app/build.gradle` a ogni rilascio.
5. In Play Console: crea l'app, carica l'`.aab` nella traccia *Test chiuso*, compila:
   - **Scheda dello store**: nome, descrizione breve e completa, icona 512×512 (`public/icons/icon-512.png`), immagine in evidenza 1024×500, almeno 2 screenshot del telefono.
   - **Norme sui contenuti**: URL della privacy (`https://tuo-dominio/privacy`), classificazione dei contenuti (app con contenuti generati dagli utenti), pubblico di destinazione (non per bambini), **Sicurezza dei dati** (vedi [store-privacy.md](store-privacy.md)), eliminazione account: indica il percorso *Impostazioni → Account e dati* e l'URL `https://tuo-dominio/settings/account`.
   - **Accesso all'app**: fornisci un account di prova (email/password) per i revisori.
6. Dopo i 14 giorni di test chiuso: richiedi l'accesso alla produzione.

## 4. App Store (iOS)

1. **Apple Developer Program** (99 $ l'anno).
2. **Non serve un Mac**: la build iOS gira su un runner macOS di GitHub Actions (`.github/workflows/mobile-ios.yml`) con firma automatica tramite chiave API di App Store Connect. (Con un Mac si può comunque fare a mano: `npm run mobile:ios`, poi in Xcode *Product → Archive*.)

### Configurazione una tantum (senza Mac)
1. **Apple Developer** (developer.apple.com → Certificates, Identifiers & Profiles):
   - registra gli identificatori `com.markg981.mestolo` (app) e `com.markg981.mestolo.ShareExtension` (estensione);
   - registra l'**App Group** `group.com.markg981.mestolo` e abilitalo su entrambi gli identificatori (Capabilities → App Groups). Se l'identificatore app ha un altro id (`CAP_APP_ID`), cambia anche i due `.entitlements`, `ShareViewController.swift` e i bundle id nel progetto.
2. **App Store Connect** → Apps → "+" → nuova app iOS con bundle id `com.markg981.mestolo` (serve prima di poter caricare build).
3. **App Store Connect → Utenti e accessi → Integrazioni → Chiavi API** (ruolo *App Manager* o *Admin*): genera la chiave, scarica il `.p8` (si scarica una sola volta), annota *Key ID* e *Issuer ID*.
4. Su GitHub → Settings → Secrets and variables → Actions:
   - Secrets: `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_PRIVATE_KEY` (contenuto del `.p8`, in chiaro oppure in base64: `base64 -w0 AuthKey_XXXX.p8`);
   - Variables: `APPLE_TEAM_ID` (10 caratteri, da Membership), `CAP_SERVER_URL` (sito pubblicato, https), opzionale `CAP_APP_ID`.

### Lanciare una build TestFlight
1. GitHub → Actions → **Mobile iOS (TestFlight)** → *Run workflow* (oppure push di un tag `v*`).
2. Il job verifica la configurazione (se manca un secret/variabile fallisce subito con l'elenco), esegue `npm run mobile:sync`, archivia lo schema `App` con firma automatica (crea da solo certificato e profili per app ed estensione), esporta l'`.ipa` (scaricabile come artifact per 14 giorni) e la carica con `xcrun altool` usando la chiave API.
3. Il **numero di build** è il numero di run del workflow (`CURRENT_PROJECT_VERSION` passato a `xcodebuild`, sempre crescente). La *Version* (`MARKETING_VERSION`) si cambia con lo script di versione / nel progetto.
4. Dopo qualche minuto (elaborazione di Apple) la build compare in App Store Connect → TestFlight: aggiungi i tester interni (subito) o esterni (richiede una breve revisione).

### Scheda dello store e revisione
1. Il progetto include già il **privacy manifest** (`PrivacyInfo.xcprivacy` per app ed estensione: nessun tracciamento, nessun dato raccolto dal codice nativo, API UserDefaults e timestamp file dichiarate) e `ITSAppUsesNonExemptEncryption = false`. I testi dei permessi (fotocamera, libreria foto) sono in italiano.
2. In App Store Connect compila:
   - URL privacy e URL di supporto (pagina `/terms` o un sito con il contatto).
   - **Privacy Nutrition Label** (vedi [store-privacy.md](store-privacy.md)).
   - **Note per la revisione**: account di prova, spiegazione delle funzioni native (fotocamera per le pagine del ricettario, offline), e del sistema di moderazione (segnalazione, blocco, nascondimento automatico dopo 3 segnalazioni, pannello moderatori, contatto di supporto).
   - Classificazione per età con contenuti generati dagli utenti.
3. Invia per la revisione.

## 5. Requisiti degli store già coperti dall'app

| Requisito | Dove |
|---|---|
| Eliminazione account dall'app | *Impostazioni → Account e dati* (cancella dati e file) |
| Segnalazione contenuti | menu della ricetta → *Segnala* |
| Blocco utenti | menu della ricetta, pagina *Amici* |
| Filtro dei contenuti inappropriati | ricetta nascosta automaticamente dopo 3 segnalazioni da utenti diversi, finché un moderatore non la esamina |
| Moderazione con tempi di risposta | pagina `/moderation` per i moderatori (vedi sotto) |
| Contatto pubblico | `NEXT_PUBLIC_SUPPORT_EMAIL`, mostrato in privacy, regole e impostazioni |
| Regole d'uso accettate alla registrazione | `/terms` + casella obbligatoria nella registrazione |
| Informativa privacy | `/privacy` (da completare con i dati del gestore) |
| Dichiarazione dei contenuti AI | immagini etichettate "generata con AI", traduzioni "automatiche", suggerimenti distinti dall'originale |

### Nominare un moderatore
Nel *SQL Editor* di Supabase:
```sql
update public.profiles set is_moderator = true where username = 'tuo_nome_utente';
```
Il moderatore vede la voce *Moderazione* nel menu. Gli utenti non possono attribuirsi il ruolo (lo impedisce un trigger nel database).

## 6. Modifiche fatte ai progetti generati (da riapplicare se rigeneri `android/` o `ios/`)

- `android/app/src/main/AndroidManifest.xml`: `intent-filter` `ACTION_SEND` `text/plain` sulla `MainActivity`.
- `android/app/src/main/java/.../MainActivity.java`: gestione della condivisione verso `/share`.
- `ios/App/App/Info.plist`: `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`, `ITSAppUsesNonExemptEncryption = false`, `WKAppBoundDomains` (aggiornato da `npm run mobile:sync`), schema URL `mestolo`.
- `ios/App/App.xcodeproj/project.pbxproj`: target `ShareExtension` (con fase "Embed Foundation Extensions"), `App.entitlements` (App Group), `PrivacyInfo.xcprivacy` di app ed estensione.
- `ios/App/ExportOptions.plist`: opzioni di export usate dal workflow.

## Cosa NON è stato verificato

L'ambiente di sviluppo usato non poteva scaricare SDK Android, Gradle o Xcode: le app **non sono state compilate né provate su un dispositivo**. Il codice nativo aggiunto è minimo (un `intent-filter` e una classe Java di ~40 righe), ma va verificato con la prima build in Android Studio.

Per iOS, i file di progetto (target `ShareExtension` nel `project.pbxproj`, plist, privacy manifest) e il workflow sono stati scritti e validati solo in modo statico (parsing dei plist, YAML, coerenza degli ID): **la prima esecuzione di `mobile-ios.yml` è il vero collaudo** e può richiedere aggiustamenti (nome dell'immagine/Xcode sul runner, permessi della chiave API, App Group non ancora registrato). Da provare su un iPhone vero: fotocamera, condivisione da Safari verso Mestolo, apertura offline.
