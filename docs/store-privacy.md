# Risposte per le schede privacy degli store (bozza verificata sul codice)

Basata sull'audit del codice (ottobre 2026). **Non è consulenza legale: va verificata dal gestore** (titolare del trattamento) prima dell'invio, in particolare per i provider AI, l'SMTP e le regioni scelte. Va tenuta coerente con `/privacy` (`messages/*.json`, chiavi `privacy.*`).

## Audit: cosa raccoglie davvero l'app

| Componente | Dove | Cosa invia / tratta |
|---|---|---|
| **Sentry** (`@sentry/nextjs`) | `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/lib/monitoring/scrub.ts` | **Attivo solo se è impostato un DSN** (`SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`). Crash ed errori (stack trace), prestazioni campionate (`tracesSampleRate` 5% di default). `sendDefaultPii: false`, **nessun Session Replay**, nessun feedback widget. `beforeSend`/`beforeSendTransaction`/`beforeBreadcrumb` rimuovono cookie, header di autorizzazione, email, token/JWT, query string, body e testo delle ricette; dell'utente resta **solo l'ID interno**. Restano: tipo di errore, URL senza query, browser/OS/dispositivo, timestamp. L'IP non è inviato dall'SDK (`sendDefaultPii` false); il server Sentry può comunque vederlo in rete: impostare in Sentry "Prevent Storing of IP Addresses". |
| **Supabase** | auth, DB, storage | Email, hash password, profilo, ricette, immagini, note, raccolte, liste, piano, amicizie, preferenze, uso AI, chiavi API cifrate (AES-256-GCM). Responsabile del trattamento. |
| **Provider AI** (Anthropic, endpoint compatibili OpenAI, `src/lib/ai/providers.ts`) | solo su azione dell'utente | Testo ricetta, foto di pagine, testo da tradurre/analizzare, eventuale trascrizione video. Chiave del gestore o dell'utente (BYOK). |
| **Import da link/video** | `src/lib/import/safe-fetch.ts`, `video-import.ts` | Il server scarica la pagina indicata dall'utente (protezione SSRF); nessun dato personale verso terzi oltre all'URL richiesto. |
| **SMTP** | email di Supabase Auth | Indirizzo email e testo del messaggio di servizio. |
| **Hosting** (es. Vercel) | log di richiesta | IP e log tecnici, per sicurezza. |
| **Capacitor** | `camera`, `filesystem`, `local-notifications`, `app`, `splash-screen`, `status-bar` | Fotocamera: solo su azione dell'utente (foto per import/ricetta), nessun accesso continuo alla libreria. Notifiche **nell'app nativa**: solo locali (promemoria pasti), nessun push server, nessun token push (nessun FCM/APNs). Vedi la riga "Web Push (PWA)" per la versione web. Nessun plugin di analytics/pubblicità/posizione. |
| **Web Push (PWA / browser)** | `src/app/actions/notifications.ts`, `src/app/api/cron/meal-reminders/route.ts`, tabella `push_subscriptions` | **Solo sul web e solo se l'utente attiva le notifiche.** Si usa Web Push con chiavi VAPID. Salvati in Supabase, collegati all'account: `endpoint` della sottoscrizione, chiavi `p256dh` e `auth`. Un cron lato server invia i promemoria all'endpoint, cioè al **servizio push del browser** (es. Google FCM, Mozilla, Apple), che riceve l'endpoint e il payload cifrato con le chiavi della sottoscrizione. Disattivando le notifiche la sottoscrizione viene rimossa; i dati sono inclusi nell'esportazione e cancellati con l'account. Coerente con `privacy.push` in `messages/*.json`. |
| Analytics, SDK pubblicitari, geolocalizzazione, contatti | — | **Nessuno.** |

## Permessi dichiarati nei manifest nativi (microfono, riconoscimento vocale, notifiche, rete)

Verificati su `android/app/src/main/AndroidManifest.xml`, `ios/App/App/Info.plist` e sui manifest dei plugin Capacitor (che Gradle unisce nel manifest finale). Da riverificare ad ogni aggiunta di plugin o permesso.

| Piattaforma | Permesso | Origine | Scopo | Trattamento dei dati |
|---|---|---|---|---|
| Android | `INTERNET` | `AndroidManifest.xml:43` | Comunicazione con il backend (Supabase, server dell'app) | Dati descritti sopra, cifrati in transito (HTTPS). |
| Android | `RECORD_AUDIO` | `AndroidManifest.xml:44` | Comandi vocali in modalita cucina (`CookMode.tsx`) e dettatura nell'assistente (`CookAssistant.tsx`) | Richiesto a runtime solo quando l'utente attiva il microfono. Nessun audio e registrato o salvato da Mestolo (nessun `MediaRecorder`, nessun upload). |
| Android | `MODIFY_AUDIO_SETTINGS` | `AndroidManifest.xml:45` | Gestione dell'audio durante l'ascolto | Nessun dato. |
| Android | `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `SCHEDULE_EXACT_ALARM` | manifest di `@capacitor/local-notifications` (unito al build) | Promemoria pasti locali, pianificati all'ora esatta e ripristinati dopo il riavvio | Solo notifiche locali sul dispositivo: nessun token push, nessun dato inviato a server. `SCHEDULE_EXACT_ALARM` puo richiedere una dichiarazione in Play Console (uso: promemoria/sveglia scelti dall'utente). |
| iOS | `NSMicrophoneUsageDescription` | `Info.plist:11` | Comandi vocali in modalita cucina e assistente | Come sopra: nessuna registrazione conservata da Mestolo. |
| iOS | `NSSpeechRecognitionUsageDescription` | `Info.plist:13` | Riconoscimento vocale dei comandi mentre si cucina | Vedi sotto: il riconoscimento e eseguito dal servizio di sistema. |
| iOS | `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` | `Info.plist` | Foto di pagine e ricette; scelta/salvataggio in libreria | Solo su azione dell'utente, come in tabella "Capacitor". |

**Dove va l'audio del riconoscimento vocale.** `CookMode.tsx` (righe 63-64) e `CookAssistant.tsx` usano la Web Speech API del WebView (`SpeechRecognition` / `webkitSpeechRecognition`). Mestolo non riceve l'audio ma solo il testo trascritto, usato in locale per riconoscere i comandi (avanti/indietro, ecc.) o per compilare il campo di testo dell'assistente. L'elaborazione dell'audio e a carico del servizio di sistema: su Android del riconoscimento vocale di Google (puo avvenire in cloud), su iOS di Apple Speech (on-device o server Apple a seconda di lingua e dispositivo). Mestolo non controlla questa elaborazione ne la conserva. Il testo dettato nell'assistente viene inviato al provider AI solo se l'utente invia il messaggio. Va menzionato in `/privacy`.

**Distinzione dalla trascrizione video.** L'import da video estrae l'audio nel browser (`src/lib/import/audio.ts`) e lo invia al provider AI per la trascrizione solo su azione esplicita dell'utente; non usa il permesso microfono.

Conseguenze per le schede: Google Play, "Audio -> Registrazioni vocali o audio" = **non raccolto da Mestolo** (elaborazione affidata al riconoscimento vocale di sistema); Apple, nessun tipo *Audio Data* raccolto, ma `NSMicrophoneUsageDescription` e `NSSpeechRecognitionUsageDescription` devono restare presenti e coerenti con questa sezione. Il gestore deve confermare questa lettura prima dell'invio.

## Dati raccolti

| Dato | Raccolto | Scopo | Collegato all'identità | Tracciamento |
|---|---|---|---|---|
| Email | Sì | Account, email di servizio | Sì | No |
| Nome utente, nome visualizzato, bio | Sì | Profilo, ricerca amici | Sì | No |
| Foto (immagini delle ricette caricate) | Sì | Funzionalità dell'app | Sì | No |
| Foto delle pagine per l'import | Elaborate, **non conservate** | Lettura del testo tramite il provider AI | — | No |
| Contenuti generati dall'utente (ricette, note, raccolte, liste, piano) | Sì | Funzionalità dell'app | Sì | No |
| Preferenze alimentari dichiarate (facoltative) | Sì | Filtro della sezione Scopri | Sì | No |
| ID utente | Sì | Funzionamento del servizio; **anche inviato a Sentry** | Sì | No |
| Conteggio uso funzioni AI | Sì | Quote giornaliere | Sì | No |
| **Dati di crash / log di errori (Sentry)** | **Sì, se il DSN è configurato** | Diagnostica e stabilità (non analytics) | Sì (solo ID interno, non email) | No |
| **Dati sulle prestazioni (Sentry, campione 5%)** | **Sì, se il DSN è configurato** | Diagnostica | Sì (solo ID interno) | No |
| Indirizzo IP / log del server | Sì (hosting, Supabase) | Sicurezza e prevenzione abusi | Non usato per profilare | No |
| Posizione | **No** (i metadati GPS delle foto sono rimossi) | — | — | — |
| Contatti, cronologia di navigazione, dati finanziari, salute | **No** | — | — | — |
| Identificatori pubblicitari, tracciamento tra app | **No** | — | — | — |

## Condivisione con terze parti
- **Supabase** (database, autenticazione, file): responsabile del trattamento.
- **Hosting** (es. Vercel): responsabile del trattamento.
- **Sentry**: responsabile del trattamento, diagnostica di errori e prestazioni con dati scrubbati.
- **Provider AI** (Anthropic/OpenAI/altro configurato), **solo quando l'utente usa una funzione AI**: testo della ricetta o foto delle pagine ("funzionalità dell'app").
- **SMTP** (es. Resend): email di servizio.
- Nessuna vendita di dati, nessuna pubblicità, nessun broker di dati.

## Sicurezza
- Dati cifrati in transito (HTTPS).
- Chiavi API personali cifrate a riposo (AES-256-GCM).
- **Eliminazione**: direttamente in app (*Impostazioni → Account e dati*), con effetto immediato su account, ricette e file.
- **Esportazione** dei dati: sì, in JSON.

## Google Play – Sicurezza dei dati
Dichiarare "L'app raccoglie dati" = **Sì**; "Dati cifrati in transito" = **Sì**; "Possibilità di richiedere l'eliminazione" = **Sì** (in app; indicare anche l'URL web di eliminazione se richiesto).

| Categoria / tipo | Raccolto | Condiviso | Obbligatorio | Scopo |
|---|---|---|---|---|
| Info personali → Indirizzo email | Sì | No (i fornitori che trattano per conto nostro non contano come "condivisione") | Sì | Funzionalità dell'app, gestione dell'account |
| Info personali → Nome (nome utente/visualizzato) | Sì | No | Sì | Funzionalità dell'app, gestione dell'account |
| Info personali → ID utente | Sì | No | Sì | Funzionalità dell'app, gestione dell'account, **analisi/diagnostica non pubblicitaria** (Sentry) |
| Foto e video → Foto | Sì | **Sì**, con il provider AI solo su richiesta dell'utente | No | Funzionalità dell'app |
| Attività nell'app → Altri contenuti generati dagli utenti | Sì | **Sì** (testo ricetta al provider AI solo su richiesta) | No | Funzionalità dell'app |
| **Log di app e prestazioni → Log di arresto anomalo** | **Sì** | No (Sentry come responsabile) | Sì | **Analisi / Prestazioni** |
| **Log di app e prestazioni → Diagnostica** | **Sì** | No | Sì | Analisi / Prestazioni |
| Posizione, contatti, dati finanziari, salute, identificatori dispositivo o pubblicitari | No | — | — | — |

## Apple – Privacy Nutrition Label
- *Contact Info → Email Address*: App Functionality, Linked to You.
- *Contact Info → Name* (nome utente/visualizzato): App Functionality, Linked to You.
- *User Content → Photos or Videos*, *Other User Content*: App Functionality, Linked to You.
- *Identifiers → User ID*: App Functionality, Linked to You.
- *Usage Data → Product Interaction* (conteggio uso AI): App Functionality, Linked to You.
- ***Diagnostics → Crash Data*** e ***Performance Data***: App Functionality, **Linked to You** (inviamo l'ID utente interno a Sentry). Se si rimuove `user.id` dagli eventi (`scrubEvent`), diventa *Not Linked to You*.
- *Tracking*: **No** (nessun dato usato per tracciare tra app/siti di terzi; nessun IDFA). Non serve ATT.
- Privacy manifest iOS (`PrivacyInfo.xcprivacy`): se l'SDK Sentry/Capacitor lo richiede, dichiarare i motivi delle API "required reason" usate.

## Da fare del gestore
Vedi la checklist nella PR: variabili `NEXT_PUBLIC_LEGAL_*`, regioni Supabase/Sentry, DPA con i fornitori, URL di `/privacy` nelle schede degli store.
