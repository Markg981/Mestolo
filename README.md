# Mestolo

Ricettario web responsive e multiutente: ricette manuali, importazione da **foto multipagina**, da **link** e da **testo**, revisione prima del salvataggio, suggerimenti AI selezionabili uno per uno, sostituzione ingredienti, versioni e varianti, amici e visibilità (privata / amici / pubblica), sezione Scopri con ricetta del giorno, lista della spesa, piano pasti, stampa ed esportazione. Interfaccia in **italiano, inglese, spagnolo, francese, tedesco e portoghese**.

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

### Sicurezza in sintesi

- **RLS su tutte le tabelle**; il ruolo anonimo non ha accesso a nulla. Visibilità ricette calcolata da una sola funzione (`can_view_recipe_for`) che considera proprietario, amicizia accettata, pubblico, blocchi e moderazione.
- **Immagini private**: bucket non pubblico; ogni immagine passa da `/api/images/[id]`, che rilegge i permessi (RLS sulla tabella **e** sullo storage). Un URL diretto non aggira la visibilità. Le immagini copiate da siti terzi restano visibili **solo al proprietario**.
- **Attribuzione non falsificabile**: un trigger verifica che la ricetta copiata sia visibile e che l'autore dichiarato coincida; i campi di provenienza sono immutabili.
- **Versioni**: ogni modifica di contenuto crea una versione (trigger); la versione 1 è sempre l'originale. Nessuna modifica silenziosa.
- **Chiavi API utente**: cifrate AES-256-GCM con `APP_ENCRYPTION_KEY` (fuori dal DB), legate a utente+provider (AAD), tabella inaccessibile ai client, mai restituite al browser né loggate.
- **Import da URL protetto contro SSRF**: solo http/https sulle porte 80/443, niente credenziali nell'URL, blocco di IP privati/loopback/link-local/CGNAT/metadata cloud/IPv4-mapped/NAT64, **ri-validazione DNS al momento della connessione** (anti DNS-rebinding), redirect validati uno per uno (max 4), timeout e limite di dimensione.
- **Rate limiting** (tabella + funzione SQL, solo service role) su login, registrazione, recupero password, import, AI, traduzioni, immagini, richieste di amicizia, segnalazioni, chiavi.
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
tests/unit/            131 test unitari          tests/db/   22 test RLS su Postgres reale
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
- **Import da foto multipagina**: galleria o fotocamera, anteprima, riordino, sostituzione e rimozione pagine, validazione formato/dimensione/numero, compressione e rotazione sul dispositivo, provider di visione sostituibile, avvisi per pagine mancanti/testo ambiguo/campi a bassa confidenza, schermata di revisione con le foto affiancate, nuovo tentativo senza perdere le pagine. **Se nessun provider è configurato, l’OCR non viene simulato**: l’app lo dice e propone l’inserimento manuale guardando le foto.
- **Mai dati inventati**: valori non trovati restano vuoti e marcati “Non rilevato”; nessuna conversione di unità; il totale non viene calcolato sommando i tempi.
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
- **Accessibilità**: etichette, focus visibile, skip link, aree cliccabili ≥ 44 px, live region per i feedback, dialog nativi, `prefers-reduced-motion`, tema scuro automatico, testo alternativo.

### Parziali

- **Verifica end-to-end con servizi reali**: non avendo credenziali Supabase e chiavi AI, non è stato possibile provare l’app collegata a un progetto Supabase reale né ai provider AI reali (vedi [Test](#test-eseguiti)).
- **HEIC** (foto iPhone): funziona dove il browser sa decodificarlo (Safari); altrove l’app chiede di convertire in JPG.
- **Moderazione**: le segnalazioni vengono registrate e i contenuti si nascondono con `is_hidden`, ma non c’è un pannello di moderazione: si gestisce dal dashboard Supabase.
- **Lista della spesa**: lo schema supporta più liste, l’interfaccia ne usa una.
- **Indicazioni dietetiche**: il campo `diet_hints` esiste ma non viene compilato automaticamente (scelta voluta: niente etichette di allergeni presentate come verificate); il filtro preferenze di Scopri è solo indicativo.
- **Generazione immagini**: implementata solo con provider OpenAI.

### Non implementate

- App native, notifiche push, modalità offline.
- Condivisione tramite link pubblico (voluta: non deve aggirare la modalità “amici”).
- Valori nutrizionali.
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
2. Apri *SQL Editor*, incolla ed esegui `supabase/migrations/20261020000001_init.sql`.
3. *Authentication → URL Configuration*: imposta *Site URL* (es. `http://localhost:3000`) e aggiungi `http://localhost:3000/auth/callback` ai *Redirect URLs*.
4. Copia URL, `anon key` e `service_role key` (Project Settings → API) in `.env.local`.

**Opzione B – Supabase CLI**: `npx supabase init` (solo la prima volta), `npx supabase link --project-ref <ref>`, poi `npx supabase db push`.

Catalogo iniziale facoltativo per la sezione Scopri:
```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:catalog
```

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

**Funzioni sempre gratuite e senza AI**: ricettario, editor, import da link con dati strutturati, analisi del testo incollato, sostituzioni di base, categorie automatiche, duplicati, porzioni, raccolte, amici, Scopri, lista della spesa, piano pasti, stampa, esportazioni.

---

## Variabili d’ambiente

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | sì | URL del progetto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sì | Chiave pubblica (soggetta a RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | sì | Solo server: chiavi cifrate, quote AI, cache traduzioni, rate limiting, eliminazione account |
| `NEXT_PUBLIC_SITE_URL` | sì | URL pubblico, per i link nelle email |
| `APP_ENCRYPTION_KEY` | per le chiavi utente | 32 byte base64 (`npm run gen:key`); senza, il salvataggio di chiavi personali è disabilitato |
| `AI_APP_PROVIDER` | no | `anthropic` \| `openai` \| `openai-compatible` – servizio base pagato dal gestore |
| `AI_APP_API_KEY`, `AI_APP_BASE_URL` | no | Chiave del gestore; base URL solo per `openai-compatible` |
| `AI_APP_TEXT_MODEL`, `AI_APP_VISION_MODEL` | no | Modelli del servizio base |
| `AI_APP_IMAGE_ENABLED`, `AI_APP_IMAGE_MODEL` | no | Generazione immagini con la chiave del gestore (solo OpenAI) |
| `AI_DAILY_LIMIT_TEXT/VISION/IMAGE/TRANSLATE` | no | Quote giornaliere per utente sul servizio base (default 20/10/2/30) |
| `AI_USER_ANTHROPIC_MODEL`, `AI_USER_OPENAI_TEXT_MODEL`, `AI_USER_OPENAI_IMAGE_MODEL` | no | Modelli usati con le chiavi personali |

Configurazione di provider, modelli, costi e privacy: **[docs/ai-providers.md](docs/ai-providers.md)**.

---

## Test eseguiti

| Comando | Cosa verifica | Risultato |
|---|---|---|
| `npm test` | 131 test unitari: parser ingredienti (6 lingue), testo incollato, durate, estrazione Schema.org/microdata/testo, SSRF (IP privati, DNS, rebinding), cifratura chiavi, provider AI, normalizzazione output AI, applicazione selettiva dei suggerimenti, traduzioni (struttura e invalidazione), sostituzioni, categorie, duplicati, scalatura, unione lista spesa, export, validazione input, completezza i18n (chiavi usate nel codice, 6 lingue, sintassi ICU) | ✅ 131/131 |
| `npm run db:test:local` | 22 test **su PostgreSQL 16 reale** con migrazioni applicate e uno stub degli schemi `auth`/`storage` di Supabase: privata di default, accesso negato ad altri utenti (anche via storage con path esatto), amici solo se accettati, blocchi, immagini importate solo al proprietario, chiavi API illeggibili, traduzioni/uso AI non falsificabili, attribuzione non falsificabile, versioni e originale, invalidazione hash, moderazione, note/raccolte/liste/piano privati, segnalazioni, ricerca utenti, categorie altrui | ✅ 22/22 |
| `npm run typecheck`, `npm run lint`, `npm run build` | Tipi, regole React/Next, build di produzione | ✅ |
| Verifica visiva | Screenshot di landing, login, home, ricettario, ricetta, editor, import foto, spesa, piano, Scopri a 390 px e 1280 px, tema chiaro e scuro, con un **server fittizio** che imita l’API Supabase | ✅ nessun errore in pagina |

**Dichiarazione sui mock**: i test dei provider AI usano `fetch` simulato e verificano formato delle richieste, gestione delle chiavi e validazione delle risposte, **non** il comportamento reale dei provider. Lo stub Supabase per i test RLS riproduce `auth.uid()`, ruoli e `storage.objects`, non l’intera piattaforma. La verifica visiva usa dati fittizi.

`npm run db:test:local` richiede `initdb`/`pg_ctl` (PostgreSQL ≥ 15) e un utente non root.

---

## Limiti noti, costi e privacy

- I provider AI possono sbagliare: per questo ogni risultato passa da una revisione e nulla viene salvato senza conferma.
- Siti con contenuti caricati via JavaScript o a pagamento possono non essere importabili: l’app lo dice e propone di incollare il testo.
- Il servizio base AI ha un costo per il gestore: tienilo spento (`AI_APP_PROVIDER` vuoto) o con quote basse finché non sai quanto costa.
- Le foto inviate all’OCR e i testi inviati all’AI vengono trattati dal provider secondo i suoi termini (vedi [docs/ai-providers.md](docs/ai-providers.md)); la pagina `/privacy` va completata dal gestore con i propri riferimenti.
- Prima di offrire l’uso di chiavi personali verifica i termini attuali dei provider (non è stato possibile farlo con valore legale in questa sede).

## Prossimi passi consigliati

1. Collegare un progetto Supabase, configurare SMTP e fare un giro completo sui 14 criteri di accettazione con due account reali.
2. Test end-to-end automatici (Playwright) contro un progetto Supabase di staging.
3. Pannello di moderazione per le segnalazioni.
4. Import del formato JSON esportato; più liste della spesa; drag & drop nel piano.
5. Monitoraggio errori (es. Sentry) con la stessa politica di redazione dei log.
