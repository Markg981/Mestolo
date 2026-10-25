# Mestolo

Ricettario **web, Android e iOS** con un solo codice (Next.js + Capacitor), multiutente: ricette manuali, importazione da **foto multipagina**, da **link** e da **testo**, revisione prima del salvataggio, suggerimenti AI selezionabili uno per uno, sostituzione ingredienti, versioni e varianti, amici e visibilità (privata / amici / pubblica), sezione Scopri con ricetta del giorno, lista della spesa, piano pasti, stampa ed esportazione. Interfaccia in **italiano, inglese, spagnolo, francese, tedesco e portoghese**.

> Stato: le 5 fasi richieste sono implementate e testate per quanto possibile **senza credenziali esterne**. Vedi [Funzionalità](#funzionalità) per l'elenco onesto di cosa è completo, parziale o mancante.

---

## Architettura

| Livello | Scelta | Perché |
|---|---|---|
| App web | **Next.js 16** (App Router, Server Components, Server Actions), React 19, TypeScript | Un'unica app per telefono, tablet e desktop; rendering lato server veloce su mobile; deploy in un clic su Vercel. |
| Stile | **Tailwind CSS 4**, design system proprio (token in `src/app/globals.css`), font self-hosted (Bricolage Grotesque + Atkinson Hyperlegible Next) | Nessuna dipendenza da CDN esterni, CSP restrittiva, leggibilità elevata. |
| Dati, auth, file | **Supabase** (Postgres, Auth, Storage) | Database relazionale con **Row Level Security**: i permessi sono applicati dal database, non solo dall'interfaccia. Piano gratuito adatto a iniziare. |
| i18n | **next-intl** (lingua da cookie/profilo/`Accept-Language`) | Aggiungere una lingua = aggiungere un file in `messages/` (un test verifica la completezza). |
| AI | Provider sostituibili via HTTPS (`src/lib/ai/providers.ts`): **Anthropic**, **OpenAI**, **endpoint compatibile OpenAI** (Ollama, OpenRouter, Mistral, Groq…) | Nessun lock-in; il gestore può offrire un servizio base con quote, l'utente può usare la propria chiave. |
| Immagini | `sharp` lato server | Rotazione EXIF, **rimozione metadati/GPS**, WebP 1600 px + miniatura 480 px. |
| PWA | service worker e manifest propri (`public/sw.js`) | Copie offline delle pagine aperte, installazione, "Condividi → Mestolo" su Android. |
| App store | **Capacitor 8** (`android/`, `ios/`) | Le app caricano il sito pubblicato e aggiungono fotocamera nativa, condivisione e pagina offline: un solo codice per web, Android e iOS. Guida: [docs/mobile.md](docs/mobile.md). |

### Sicurezza in sintesi

- **RLS su tutte le tabelle**; il ruolo anonimo non ha accesso a nulla. Visibilità ricette calcolata da una sola funzione (`can_view_recipe_for`) che considera proprietario, amicizia accettata, pubblico, blocchi e moderazione.
- **Immagini private**: bucket non pubblico; ogni immagine passa da `/api/images/[id]`, che rilegge i permessi (RLS sulla tabella **e** sullo storage). Un URL diretto non aggira la visibilità. Le immagini copiate da siti terzi restano visibili **solo al proprietario**.
- **Attribuzione non falsificabile**: un trigger verifica che la ricetta copiata sia visibile e che l'autore dichiarato coincida; i campi di provenienza sono immutabili.
- **Versioni**: ogni modifica di contenuto crea una versione (trigger); la versione 1 è sempre l'originale. Nessuna modifica silenziosa.
- **Chiavi API utente**: cifrate AES-256-GCM con `APP_ENCRYPTION_KEY` (fuori dal DB), legate a utente+provider (AAD), tabella inaccessibile ai client, mai restituite al browser né loggate.
- **Import da URL protetto contro SSRF**: solo http/https sulle porte 80/443, niente credenziali nell'URL, blocco di IP privati/loopback/link-local/CGNAT/metadata cloud/IPv4-mapped/NAT64, **ri-validazione DNS al momento della connessione** (anti DNS-rebinding), redirect validati uno per uno (max 4), timeout e limite di dimensione.
- **Rate limiting** (tabella + funzione SQL, solo service role; richieste di amicizia 30/giorno e segnalazioni 20/giorno sono imposte anche da trigger nel database) su login, registrazione, recupero password, import, AI, traduzioni, immagini, richieste di amicizia, segnalazioni, chiavi.
- Header di sicurezza e **Content-Security-Policy**; il browser parla solo con il nostro server.
- Log senza contenuti delle ricette, foto, token o chiavi (`redactSecrets`).

### Struttura

```
src/app/(auth)/        landing, login, registrazione, recupero accesso, privacy, setup
src/app/(app)/         home, ricettario, ricetta, editor, import, assistente, raccolte,
                       scopri, amici, profili, spesa, piano, impostazioni
src/app/actions/       server actions (validazione zod + autorizzazione)
src/app/api/           immagini protette, esportazioni
src/lib/recipes/       parser ingredienti/testo, unità, categorie, duplicati, scalatura,
                       suggerimenti AI, traduzioni, export, sostituzioni di base
src/lib/import/        protezione SSRF, fetch sicuro, estrazione Schema.org/microdata
src/lib/ai/            provider, prompt, risoluzione chiave/quote
supabase/migrations/   schema versionato con RLS e storage
tests/unit/            test unitari (Vitest)     tests/db/   test RLS su Postgres reale
e2e/                   test end-to-end (Playwright)
messages/              traduzioni dell'interfaccia (6 lingue)
```

---

## Funzionalità

### Completate (codice + test dove possibile)

- **Account**: registrazione con conferma email, login, logout, recupero password, profilo (nome utente, nome, bio, reperibilità), lingua, preferenze alimentari.
- **Ricette**: modello completo (proprietario, lingua originale, ingredienti strutturati con quantità/intervalli/unità/note/“q.b.”, porzioni, tempi, passaggi, categoria, tag, immagini con tipo e provenienza, fonte e attribuzione, note personali private, visibilità **privata di default**, versione, cronologia, varianti, stato di verifica e flag per campo).
- **Editor** mobile-first con riordino, incolla-lista ingredienti, bozza salvata automaticamente nel browser (nessuna perdita dati in caso di errore), categoria proposta automaticamente e modificabile, avviso **possibili duplicati**.
- **Import da link**: Schema.org JSON-LD (anche `@graph`, `HowToSection`), poi microdata, poi testo leggibile (segnato a bassa confidenza); revisione obbligatoria; fonte, sito e autore salvati; alternativa “incolla il testo”.
- **Import da testo**: parser gratuito multilingue (intestazioni, porzioni, tempi) oppure AI.
- **Import da foto multipagina**: galleria o fotocamera, anteprima, riordino, sostituzione e rimozione pagine, validazione formato/dimensione/numero, compressione e rotazione sul dispositivo, provider di visione sostituibile, avvisi per pagine mancanti/testo ambiguo/campi a bassa confidenza, schermata di revisione con le foto affiancate, nuovo tentativo senza perdere le pagine. **OCR gratuito sul dispositivo, senza AI e senza chiavi**: Tesseract.js nel browser (motore e dati delle 6 lingue serviti dall’app, copiati in `public/ocr` da `scripts/copy-ocr-assets.mjs` prima di `dev`/`build`) e ML Kit nell’app Android/iOS (`@capacitor-mlkit/text-recognition`, con Tesseract come ripiego). Il testo letto si corregge in un campo modificabile, poi il parser gratuito lo divide in titolo, ingredienti, passaggi, porzioni e tempi e si passa alla revisione. Le foto non lasciano il dispositivo. L’estrazione con AI resta un pulsante separato e facoltativo, utile per scrittura a mano o impaginazioni complesse.
- **Mai dati inventati**: valori non trovati restano vuoti e marcati “Non rilevato”; nessuna conversione di unità all’importazione; il totale non viene calcolato sommando i tempi.
- **Categorie** iniziali (10 + “Da classificare”), categorie personali, tag, raccolte, ricerca, filtri, preferiti, ordinamento.
- **Assistente AI**: suggerimenti tipizzati (passaggi più chiari, correzioni/aggiunte di ingredienti, stime di tempo marcate come stime, idee), confronto originale/proposta, selezione singola, tre azioni finali (mantieni l’originale / applica i selezionati / salva come variante collegata), suggerimenti obsoleti scartati.
- **Sostituzioni**: tabella di base gratuita (10 ingredienti comuni, 6 lingue) + AI facoltativa; quantità indicative, effetto, limiti, avviso “può compromettere la riuscita”, nessuna promessa su allergie.
- **Porzioni**: ricalcolo lineare nella pagina ricetta (unità mai convertite, avviso su tempi e lievitazioni).
- **Immagini**: upload, segnaposto elegante, domanda “Vuoi generare un’immagine?”, generazione **solo dopo conferma** con indicazione di chiave e costi, etichetta “generata con AI”.
- **Traduzione delle ricette**: proposta quando la lingua differisce, cache per lingua legata all’hash del contenuto (invalidata se l’originale cambia), etichetta “traduzione automatica”, ritorno all’originale, quantità/unità reinserite dall’originale (non possono essere alterate).
- **Social**: ricerca utenti nel rispetto della reperibilità, richieste di amicizia (invio, accetta, rifiuta, annulla, rimuovi), blocco/sblocco, segnalazioni, profili con le sole ricette visibili, salvataggio di ricette altrui come **copia** (con attribuzione), **preferito** o **variante**.
- **Scopri e ricetta del giorno**: ricette pubbliche e degli amici (mai le proprie), filtro per categoria e preferenze (indicativo), scelta del giorno deterministica, stato vuoto onesto. Catalogo iniziale originale opzionale (`npm run seed:catalog`).
- **Lista della spesa**: aggiunta manuale (con parsing “500 g pomodori”), da ricetta con porzioni scelte, spunta, svuota presi, **somma solo se nome e unità coincidono**, stampa.
- **Piano pasti** settimanale (4 pasti al giorno), da ricette proprie o preferite o testo libero, “ingredienti della settimana nella lista”.
- **Stampa** ricetta e lista; **export** ricetta in JSON Mestolo e Schema.org JSON-LD ([formato](docs/export-format.md)); **export di tutti i dati** dell’account; **eliminazione account** (file compresi).
- **API key personali**: inserimento, sostituzione, rimozione; stato per funzione (“userà la tua chiave” / “servizio base: 7 di 10 oggi” / “non disponibile”); uso negli ultimi 30 giorni.
- **Moderazione** (richiesta dagli store): ruolo moderatore assegnabile solo dal gestore, pannello `/moderation`, nascondi/ripristina/archivia, **nascondimento automatico dopo 3 segnalazioni** di utenti diversi, regole della community (`/terms`) accettate alla registrazione, contatto di supporto (`NEXT_PUBLIC_SUPPORT_EMAIL`).
- **PWA e app**: installabile, copie offline delle pagine aperte (svuotate al logout), condivisione di link verso Mestolo, progetti Android/iOS Capacitor con fotocamera nativa e pagina offline locale.
- **Import da video**: da descrizione, sottotitoli e trascrizione audio (la trascrizione richiede un provider, vedi `AI_TRANSCRIBE_MODEL`).
- **In cucina**: modalità cucina a schermo intero con “Chiedi all’assistente”, diario “L’ho cucinata” (nota, foto, visibilità), conversione delle unità su richiesta (solo in visualizzazione, l’originale non cambia).
- **Organizzazione**: dispensa con scadenze e “cosa cucino stasera”, piano settimanale generato dalle preferenze e riordinabile con trascinamento, promemoria dei pasti ([dettagli](#promemoria-dei-pasti)), lista della spesa per reparto e condivisa con la famiglia, suggerimenti di stagione nella home.
- **Nutrizione**: valori nutrizionali per porzione, sempre con la fonte dichiarata.
- **Community**: valutazioni da 1 a 5 stelle, feed “Per te”, profili ricchi (avatar, luogo, sito, cucine preferite), raccolte condivise con amici o pubbliche, inviti con link a scadenza, pagine pubbliche indicizzabili `/r/[slug]` per le sole ricette pubbliche, sincronizzazione in tempo reale.
- **Accessibilità**: etichette, focus visibile, skip link, aree cliccabili ≥ 44 px, live region per i feedback, dialog nativi, `prefers-reduced-motion`, tema scuro automatico, testo alternativo.

### Parziali

- **Verifica end-to-end con servizi reali**: non avendo credenziali Supabase e chiavi AI, non è stato possibile provare l’app collegata a un progetto Supabase reale né ai provider AI reali (vedi [Test](#test-eseguiti)).
- **HEIC** (foto iPhone): funziona dove il browser sa decodificarlo (Safari); altrove l’app chiede di convertire in JPG.
- **App Android/iOS**: progetti generati e configurati, ma **non compilati né provati su dispositivo** (nell’ambiente di sviluppo non era possibile scaricare SDK Android/Xcode). La Share Extension iOS è descritta in [docs/ios-share-extension.md](docs/ios-share-extension.md).
- **Indicazioni dietetiche**: il campo `diet_hints` esiste ma non viene compilato automaticamente (scelta voluta: niente etichette di allergeni presentate come verificate); il filtro preferenze di Scopri è solo indicativo.
- **Generazione immagini**: implementata solo con provider OpenAI.

### Non implementate

- Modifica dei dati offline (offline si consulta, le modifiche richiedono la connessione).
- Link di condivisione per ricette private o per soli amici (voluto: non deve aggirare la modalità “amici”). Solo le ricette pubbliche hanno una pagina pubblica `/r/[slug]`.
- Import di file JSON esportati (il formato è documentato e predisposto).

---

## Avvio in locale

Requisiti: Node.js ≥ 20.9 (consigliato 22), un progetto Supabase (gratuito) oppure la Supabase CLI con Docker.

```bash
git clone https://github.com/Markg981/Mestolo.git
cd Mestolo
npm install
cp .env.example .env.local     # poi compila i valori (vedi sotto)
npm run gen:key                # genera APP_ENCRYPTION_KEY
npm run dev                    # http://localhost:3000
```

### Database

**Opzione A – progetto Supabase cloud** (più semplice):
1. Crea un progetto su [supabase.com](https://supabase.com).
2. Applica **tutte** le migrazioni di `supabase/migrations/`, in ordine di nome (la prima è `20261020000001_init.sql`; le successive aggiungono moderazione, ricerca, dispensa, nutrizione e le altre funzioni, che senza di loro non funzionano). Il modo più semplice è l’opzione B; in alternativa incollale una per una nel *SQL Editor*.
3. *Authentication → URL Configuration*: imposta *Site URL* (es. `http://localhost:3000`) e aggiungi `http://localhost:3000/auth/callback` ai *Redirect URLs*.
4. Copia URL, `anon key` e `service_role key` (Project Settings → API) in `.env.local`.

**Opzione B – Supabase CLI**: `npx supabase init` (solo la prima volta), `npx supabase link --project-ref <ref>`, poi `npx supabase db push`.

Catalogo iniziale facoltativo per la sezione Scopri:
```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:catalog
```

### Tutto in locale, senza account cloud (Supabase CLI + Docker)

Serve un runtime Docker (Docker Desktop, Rancher Desktop o Podman).

```bash
npx supabase init     # crea supabase/config.toml (le migrazioni esistenti restano)
npx supabase start    # avvia database, auth, storage e casella email locale; applica le migrazioni
npx supabase status   # mostra URL e chiavi da copiare in .env.local
```

In `supabase/config.toml`, sezione `[auth]`: `site_url = "http://localhost:3000"` e `additional_redirect_urls = ["http://localhost:3000/auth/callback"]`, poi `npx supabase stop && npx supabase start`. In `.env.local` usa `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` e le chiavi `anon` e `service_role` mostrate da `status`. Studio (dati): http://127.0.0.1:54323 · email di prova: http://127.0.0.1:54324.

### Provarlo su Android

- **Stessa rete Wi-Fi**: `npm run build && npx next start -H 0.0.0.0 -p 3000`, poi apri `http://<IP-del-PC>:3000` in Chrome sul telefono (consenti Node.js nel firewall di Windows).
- **Cavo USB**: `adb reverse tcp:3000 tcp:3000` e apri `http://localhost:3000` sul telefono.
- **Come app**: vedi [docs/mobile.md](docs/mobile.md#2-provare-lapp-su-un-telefono-android-sviluppo).

---

## Pubblicazione online (Supabase + Vercel)

1. Crea il progetto Supabase ed esegui la migrazione (come sopra).
2. Fai push del repository su GitHub e importalo su [vercel.com](https://vercel.com) (*Add New → Project*). Il framework viene riconosciuto in automatico.
3. In Vercel → *Settings → Environment Variables* inserisci le variabili di `.env.example` (`NEXT_PUBLIC_SITE_URL` = il dominio Vercel, es. `https://mestolo.vercel.app`).
4. In Supabase → *Authentication → URL Configuration*: *Site URL* = dominio pubblico; *Redirect URLs* = `https://<dominio>/auth/callback`.
5. **Email**: il server SMTP predefinito di Supabase è pensato solo per i test (limiti molto bassi e, secondo la documentazione attuale, invio solo agli indirizzi del team). Per utenti reali configura un SMTP tuo in *Authentication → SMTP Settings* (es. Resend, Postmark, Brevo).
6. Deploy. Se le variabili Supabase mancano, l’app mostra la pagina `/setup` invece di rompersi.

### Servizi e limiti dei piani gratuiti (verificati a ottobre 2026, possono cambiare)

| Servizio | Piano gratuito | Limiti rilevanti |
|---|---|---|
| **Supabase Free** | sì | 500 MB database, 1 GB file storage, 5 GB egress/mese, 50.000 utenti attivi/mese, max 2 progetti attivi; **il progetto va in pausa dopo 1 settimana di inattività** e va riattivato a mano; niente backup point-in-time. Pro da 25 $/mese. |
| **Vercel Hobby** | sì | Solo **uso personale non commerciale**; funzioni fino a 300 s; corpo della richiesta **max 4,5 MB** (per questo le foto vengono compresse sul dispositivo e l’import è limitato a 8 pagine / 4 MB); quote mensili di banda ed esecuzioni. Per un uso commerciale serve Pro. |
| **SMTP** (es. Resend) | spesso sì | Limiti giornalieri/mensili di email: controlla il piano scelto. |
| **Provider AI** | **nessun piano gratuito presunto** | Anthropic e OpenAI sono a consumo. Le funzioni “gratuite” per l’utente lo sono solo se il gestore paga il servizio base (con quote) o se l’utente usa la propria chiave. |

Fonti: [Supabase pricing (riepilogo)](https://makerkit.dev/blog/saas/supabase-pricing), [Vercel limits](https://vercel.com/docs/limits), [Vercel: body size limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).

**Funzioni sempre gratuite e senza AI**: ricettario, editor, import da link con dati strutturati, import da foto con OCR sul dispositivo, analisi del testo incollato, sostituzioni di base, categorie automatiche, duplicati, porzioni, raccolte, amici, Scopri, lista della spesa, piano pasti, stampa, esportazioni.

---

## Variabili d’ambiente

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | sì | URL del progetto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sì | Chiave pubblica (soggetta a RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | sì | Solo server: chiavi cifrate, quote AI, cache traduzioni, rate limiting, eliminazione account |
| `NEXT_PUBLIC_SITE_URL` | sì | URL pubblico, per i link nelle email |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | per gli store | Contatto di supporto mostrato in app |
| `CAP_SERVER_URL`, `CAP_APP_ID` | per le app | Sito che le app caricano e identificativo dell’app ([docs/mobile.md](docs/mobile.md)) |
| `APP_ENCRYPTION_KEY` | per le chiavi utente | 32 byte base64 (`npm run gen:key`); senza, il salvataggio di chiavi personali è disabilitato |
| `AI_APP_PROVIDER` | no | `anthropic` \| `openai` \| `openai-compatible` – servizio base pagato dal gestore |
| `AI_APP_API_KEY`, `AI_APP_BASE_URL` | no | Chiave del gestore; base URL solo per `openai-compatible` |
| `AI_APP_TEXT_MODEL`, `AI_APP_VISION_MODEL` | no | Modelli del servizio base |
| `AI_APP_IMAGE_ENABLED`, `AI_APP_IMAGE_MODEL` | no | Generazione immagini con la chiave del gestore (solo OpenAI) |
| `AI_DAILY_LIMIT_TEXT/VISION/IMAGE/TRANSLATE` | no | Quote giornaliere per utente sul servizio base (default 20/10/2/30) |
| `AI_USER_ANTHROPIC_MODEL`, `AI_USER_OPENAI_TEXT_MODEL`, `AI_USER_OPENAI_IMAGE_MODEL` | no | Modelli usati con le chiavi personali |
| `CRON_SECRET` | per la pulizia | Segreto del cron Vercel (`vercel.json`) che chiama `/api/cron/cleanup` (rimuove file immagine orfani e dati di quota oltre 90 giorni). Senza, la route risponde sempre 401. In Supabase abilitare anche l’estensione `pg_cron` (Database > Extensions) per la pulizia giornaliera lato database |
| `MEAL_REMINDERS_WINDOW_MINUTES` | no | Finestra (minuti, 1-120, default 20) entro cui la route recupera i promemoria scaduti. Vedi *Frequenza del cron* |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no | Promemoria dei pasti via Web Push (PWA). Generare le chiavi con `npx web-push generate-vapid-keys`; `VAPID_SUBJECT` è un `mailto:` o un URL https. La chiave pubblica è incorporata in build (richiede un nuovo deploy se cambia). Senza chiavi la route `/api/cron/meal-reminders` non invia nulla e il web non offre le notifiche (l’app nativa usa notifiche locali e non ne ha bisogno). Vedi [Promemoria dei pasti](#promemoria-dei-pasti) |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN` | no | Monitoraggio errori Sentry (client+server+edge / solo server+edge). Senza DSN è completamente disattivato. Gli eventi sono ripuliti (email, token, cookie, testo delle ricette, chiavi) prima dell’invio; `sendDefaultPii` è sempre false |
| `SENTRY_TRACES_SAMPLE_RATE` | no | Frazione di tracce 0-1 (default 0,05) |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | no | Solo in build, per caricare le source map |

Configurazione di provider, modelli, costi e privacy: **[docs/ai-providers.md](docs/ai-providers.md)**.

### Promemoria dei pasti

Da Impostazioni l’utente attiva i promemoria dei pasti del piano settimanale (es. «Stasera: Risotto ai funghi»), con un orario per ogni pasto; il fuso orario IANA viene preso dal dispositivo.

- **App nativa (Android/iOS)**: notifiche locali (`@capacitor/local-notifications`) pianificate per i prossimi 7 giorni; vengono annullate e ripianificate all’apertura dell’app, quando torna in primo piano, quando si cambiano le preferenze e quando si apre il piano. Nessun server coinvolto. Dopo aver aggiornato le dipendenze serve **`npx cap sync`** (o `npm run mobile:sync`) e una nuova build nativa dell’app, perché il plugin contiene codice nativo; le app già installate senza il plugin non pianificano nulla.
- **Web/PWA**: Web Push con VAPID. La migrazione `20261024000002` crea `push_subscriptions`, `notification_preferences` e `meal_reminders_sent` (dedup). Il service worker gestisce `push` e `notificationclick` (apre `/plan`). La route `/api/cron/meal-reminders` (protetta da `CRON_SECRET` come `/api/cron/cleanup`) invia i promemoria scaduti negli ultimi 20 minuti nel fuso dell’utente, elimina le sottoscrizioni che rispondono 404/410 e non invia mai due volte lo stesso pasto.
- **Frequenza del cron**: `vercel.json` pianifica la route **una volta al giorno** (`0 8 * * *`), l'unica frequenza ammessa dal piano Vercel **Hobby** (una pianificazione più frequente fa fallire il deploy). Con il cron giornaliero i promemoria arrivano solo se il loro orario cade nelle ultime `MEAL_REMINDERS_WINDOW_MINUTES` minuti (default 20, massimo 120): per promemoria puntuali serve una chiamata ogni 15 minuti. Su **Pro**: copiare `vercel.pro.json` su `vercel.json` (`*/15 * * * *`) e rifare il deploy. Su Hobby: chiamare `GET /api/cron/meal-reminders` ogni 15 minuti da uno scheduler esterno (GitHub Actions, cron-job.org) con header `Authorization: Bearer $CRON_SECRET`. Nessun duplicato in nessuno scenario: `meal_reminders_sent` deduplica per pasto.
- **iOS**: il Web Push funziona solo per la PWA aggiunta alla schermata Home (Safari > Condividi > Aggiungi alla schermata Home), iOS/iPadOS 16.4 o successivo; in una scheda di Safari il permesso non è disponibile. Nell’app nativa si usano invece le notifiche locali.
- **CSP**: nessuna modifica necessaria. L’iscrizione push passa dal servizio push del browser (non da `connect-src`) e le notifiche sono mostrate dal service worker, già servito da `'self'`.

---

## Test eseguiti

| Comando | Cosa verifica | Risultato |
|---|---|---|
| `npm test` | Test unitari (Vitest, centinaia di casi in `tests/unit/`): parser ingredienti (6 lingue), testo incollato, durate, estrazione Schema.org/microdata/testo, SSRF (IP privati, DNS, rebinding), cifratura chiavi, provider AI, normalizzazione output AI, applicazione selettiva dei suggerimenti, traduzioni (struttura e invalidazione), sostituzioni, categorie, duplicati, scalatura, unione lista spesa, export, validazione input, completezza i18n (chiavi usate nel codice, 6 lingue, sintassi ICU) | ✅ passati |
| `npm run db:test:local` | Test RLS **su PostgreSQL 16 reale** con migrazioni applicate e uno stub degli schemi `auth`/`storage` di Supabase: privata di default, accesso negato ad altri utenti (anche via storage con path esatto), amici solo se accettati, blocchi, immagini importate solo al proprietario, chiavi API illeggibili, traduzioni/uso AI non falsificabili, attribuzione non falsificabile, versioni e originale, invalidazione hash, moderazione, note/raccolte/liste/piano privati, segnalazioni, ricerca utenti, categorie altrui | ✅ passati |
| `npm run typecheck`, `npm run lint`, `npm run build` | Tipi, regole React/Next, build di produzione | ✅ |
| Verifica visiva | Screenshot di landing, login, home, ricettario, ricetta, editor, import foto, spesa, piano, Scopri a 390 px e 1280 px, tema chiaro e scuro, con un **server fittizio** che imita l’API Supabase | ✅ nessun errore in pagina |

**Dichiarazione sui mock**: i test dei provider AI usano `fetch` simulato e verificano formato delle richieste, gestione delle chiavi e validazione delle risposte, **non** il comportamento reale dei provider. Lo stub Supabase per i test RLS riproduce `auth.uid()`, ruoli e `storage.objects`, non l’intera piattaforma. La verifica visiva usa dati fittizi.

Il numero di test cambia a ogni PR, quindi non è riportato qui: `npm test` lo stampa a fine esecuzione.

**Eseguire le suite**

| Suite | Comando | Requisiti |
|---|---|---|
| Unitari | `npm test` (`npm run test:watch` in modalità watch) | nessuno |
| DB / RLS | `npm run db:test:local` (avvia un PostgreSQL temporaneo e applica le migrazioni) | `initdb`/`pg_ctl` (PostgreSQL ≥ 15) e un utente non root |
| DB / RLS su un Postgres già pronto | `npm run test:db` | `TEST_DATABASE_URL` con stub Supabase (`supabase/tests/supabase-stub.sql`) e migrazioni applicate |
| End-to-end | `npm run test:e2e` | progetto Supabase di staging, vedi sotto |

### Test end-to-end (Playwright)

I test in `e2e/` guidano un browser reale (Chromium desktop e viewport mobile) contro l’app collegata a un **progetto Supabase di staging**: registrazione, accesso/uscita, creazione e modifica di una ricetta, elenco, lista della spesa, piano pasti, cambio lingua. Non usare mai il progetto di produzione: i test creano e cancellano utenti con la service role key.

**Creare il progetto di staging**

1. Su [supabase.com](https://supabase.com) crea un progetto separato (es. `mestolo-staging`).
2. Applica le migrazioni: `npx supabase login`, `npx supabase link --project-ref <ref-staging>`, `npx supabase db push`.
3. In *Authentication → Providers → Email* puoi lasciare attiva la conferma email: gli utenti di test sono creati già confermati con l’API admin e il test di registrazione verifica solo l’avviso “Controlla la tua email”.
4. Da *Project Settings → API* copia URL, `anon` key e `service_role` key.

**Eseguirli in locale**

```bash
export NEXT_PUBLIC_SUPABASE_URL=https://<ref-staging>.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...
export APP_ENCRYPTION_KEY=$(npm run -s gen:key)
npx playwright install chromium
npm run test:e2e
```

Playwright avvia `next dev` sulla porta 3100 (`E2E_PORT`); per testare un ambiente già pubblicato imposta `E2E_BASE_URL`. Le variabili del progetto staging vanno comunque impostate perché il setup crea gli utenti di test (prefisso `e2e-`, dominio `example.com`) e il teardown li cancella. Il report HTML finisce in `playwright-report/`.

**CI (GitHub Actions)**

Il workflow `.github/workflows/e2e.yml` gira su push a `main`, pull request, ogni notte (cron 04:00 UTC) e a mano (*workflow_dispatch*). Aggiungi tre secret in *Settings → Secrets and variables → Actions*: `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` (valori del progetto di staging, mai di produzione). **Se mancano il job fallisce** con un `::error::` esplicito. Unica eccezione: PR da fork o da Dependabot, dove GitHub non espone i secret per design; lì il job emette un warning e non esegue i test, quindi un maintainer deve rilanciare gli E2E (workflow_dispatch su un branch del repo) prima del merge. Il report HTML è caricato come artifact `playwright-report`.

Le migrazioni dello staging non sono applicate dalla CI (evita modifiche allo schema non volute): prima di mergere migrazioni nuove esegui `npx supabase link --project-ref <ref-staging> && npx supabase db push`.

**Check obbligatorio.** Il job si chiama `Playwright (Supabase staging)` (workflow `E2E`): è il nome del required status check, non rinominarlo. Per renderlo obbligatorio su `main` (decisione del owner; da eseguire a mano, adattando gli altri check richiesti):

```bash
gh api -X PUT repos/Markg981/mestolo/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["Playwright (Supabase staging)"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
EOF
```

Attenzione: questo comando sovrascrive la protezione esistente; controllala prima con `gh api repos/Markg981/mestolo/branches/main/protection`. In alternativa usa *Settings → Branches → Branch protection rules*.

---

## Limiti noti, costi e privacy

- I provider AI possono sbagliare: per questo ogni risultato passa da una revisione e nulla viene salvato senza conferma.
- Siti con contenuti caricati via JavaScript o a pagamento possono non essere importabili: l’app lo dice e propone di incollare il testo.
- Il servizio base AI ha un costo per il gestore: tienilo spento (`AI_APP_PROVIDER` vuoto) o con quote basse finché non sai quanto costa.
- L’OCR gratuito gira sul dispositivo e non invia le foto a nessuno. Le foto e i testi inviati all’AI (solo se l’utente sceglie l’estrazione con AI) vengono trattati dal provider secondo i suoi termini (vedi [docs/ai-providers.md](docs/ai-providers.md)); la pagina `/privacy` va completata dal gestore con i propri riferimenti.
- Prima di offrire l’uso di chiavi personali verifica i termini attuali dei provider (non è stato possibile farlo con valore legale in questa sede).

## Prossimi passi consigliati

1. Collegare un progetto Supabase, configurare SMTP e fare un giro completo sui 14 criteri di accettazione con due account reali.
2. Prima build delle app in Android Studio e Xcode, test su dispositivo, test chiuso su Google Play e TestFlight ([docs/mobile.md](docs/mobile.md)).
3. Provare su dispositivo la Share Extension iOS e le notifiche locali del piano pasti.
4. Import del formato JSON esportato.
