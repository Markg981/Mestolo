# Criteri di accettazione e collaudo con servizi reali

La specifica originale con i **14 criteri di accettazione** non è nel repository. Questo file serve a due cose:

1. riportare i criteri originali (da copiare qui dalla specifica) e lo stato di ciascuno;
2. elencare le prove che nessun test automatico copre, perché richiedono chiavi AI reali o un dispositivo.

## 1. I 14 criteri

Copia il testo di ogni criterio dalla specifica. Per lo stato usa: ✅ verificato, 🟡 parziale, ❌ non soddisfatto, ⏳ da provare. In "Come verificato" indica il test automatico (file in `tests/` o `e2e/`) oppure la prova manuale, con data e ambiente.

| # | Criterio (dalla specifica) | Stato | Come verificato |
|---|---|---|---|
| 1 | | ⏳ | |
| 2 | | ⏳ | |
| 3 | | ⏳ | |
| 4 | | ⏳ | |
| 5 | | ⏳ | |
| 6 | | ⏳ | |
| 7 | | ⏳ | |
| 8 | | ⏳ | |
| 9 | | ⏳ | |
| 10 | | ⏳ | |
| 11 | | ⏳ | |
| 12 | | ⏳ | |
| 13 | | ⏳ | |
| 14 | | ⏳ | |

Finché la tabella resta vuota non si può costruire la matrice requisiti → test: è il limite principale dell'audit di ottobre 2026.

## 1bis. Affermazioni del README verificate a campione (audit ottobre 2026)

| Affermazione del README | Esito | Riferimento audit |
|---|---|---|
| Lista della spesa: somma solo se nome e unità coincidono | ✅ vera | |
| Scalatura lineare delle porzioni | ✅ vera | |
| Conversione di unità solo in visualizzazione | ✅ vera | |
| Suggerimenti AI obsoleti scartati | ✅ vera | |
| i18n completa in 6 lingue (chiavi identiche) | ✅ vera | |
| Bozza dell'editor: "nessuna perdita dati" | 🟡 → corretto: bozze per utente e scartate se più vecchie della ricetta (`tests/unit/drafts.test.ts`), scrittura immediata quando la scheda viene nascosta o chiusa, avviso se lo storage non è disponibile, revisione di un'importazione riproposta dopo un ricaricamento. Resta il limite intrinseco: la bozza vive in un solo browser | C-03, C-04 |
| Ricetta del giorno: scelta "deterministica" | 🟡 → corretto (`tests/unit/recipe-of-the-day.test.ts`) | C-26 |
| Promemoria dei pasti | 🟡 → corretto: claim e conferma con ritentativi (`tests/unit/cron-meal-reminders.test.ts`), chiamata ogni 15 min da `.github/workflows/meal-reminders.yml` (secret `APP_URL`, `CRON_SECRET`). Da verificare: workflow attivo sul repository e consegna su dispositivo reale | C-02 |
| Export "di tutti i dati" dell'account | 🟡 → corretto (`tests/unit/account-export.test.ts`) | C-05, C-06 |
| Export "di tutti i dati": anche i file | 🟡 → README corretto: il JSON contiene i metadati delle immagini e i percorsi di avatar e foto, non i file; escluse le traduzioni in cache. Un export con i file richiederebbe uno ZIP | A-02 |
| "Bozza salvata" anche al login | ❌ → corretto: la pagina di login cancellava tutte le bozze, quindi una sessione scaduta durante la modifica le perdeva. Ora il login le tiene e dopo l'accesso restano solo quelle dell'utente entrato (`tests/unit/drafts.test.ts`) | A-01 |
| "Revisione obbligatoria" degli import | ❌ per l'importazione massiva → corretto: resta senza schermata di revisione (ripristino di molte ricette), ma ogni ricetta è salvata "Da verificare" invece che verificata, e README e testo della pagina lo dicono (`tests/unit/bulk-import.test.ts`) | A-11 |
| Aree cliccabili ≥ 44 px | ❌ → corretto nei componenti, nei link del logo e nei link isolati (intestazioni, "indietro", azioni degli avvisi); misurato da `e2e/tap-targets.spec.ts` (progetto mobile, 15 pagine). Esenti come da WCAG 2.5.5 i link dentro una frase. Le pagine di accesso/registrazione e il dettaglio ricetta non sono misurati | C-27 |

Restano da fare, come già indicato nelle sezioni 3 e 4: prove con chiavi AI reali, build iOS (mai compilata) e Android su dispositivo reale con `CAP_SERVER_URL`, dati del titolare (`NEXT_PUBLIC_LEGAL_*`) in produzione, perché finché mancano `/privacy` e `/terms` mostrano un avviso e gli store le richiedono complete.

## 2. Già coperto in automatico

- **Unit test** (`npm test`, Vitest): parser, import da HTML/testo/OCR, import JSON, schema e limiti, traduzioni nelle 6 lingue, crittografia, cron, provider AI simulati.
- **End-to-end** (`e2e/`, Playwright): girano in CI con il workflow `e2e.yml` contro il progetto Supabase di staging (secret `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`), senza chiavi AI.

## 3. Prove manuali con chiavi AI reali

Da fare su staging con almeno un provider configurato (servizio base del gestore oppure chiave personale in *Impostazioni → Chiavi API*). Per ogni riga annota provider, modello, esito e costo indicativo.

| Prova | Cosa controllare | Esito |
|---|---|---|
| Import da foto con AI (2+ pagine, una scritta a mano) | campi non letti restano vuoti e marcati, nessun dato inventato | |
| Import da testo con AI | stesso risultato del parser gratuito o migliore, revisione obbligatoria | |
| Import da video con trascrizione (`AI_TRANSCRIBE_MODEL`) | ricetta dalla trascrizione, fonte salvata | |
| Assistente: suggerimenti | selezione singola, "salva come variante" crea una variante collegata | |
| Sostituzioni con AI | avviso sulla riuscita, nessuna promessa sulle allergie | |
| Traduzione ricetta | quantità e unità invariate, cache invalidata dopo una modifica | |
| Generazione immagine (OpenAI) | generata solo dopo conferma, etichetta "generata con AI" | |
| Quote del servizio base | contatore "N di 10 oggi" e blocco al limite | |
| Chiave personale non valida | errore chiaro, nessun ripiego silenzioso sul servizio base | |

## 4. Prove su dispositivo

| Prova | Android | iOS |
|---|---|---|
| Avvio con `CAP_SERVER_URL` del sito pubblicato, login | | |
| Fotocamera nativa nell'import da foto | | |
| OCR sul dispositivo (ML Kit) | | |
| "Condividi → Mestolo" da browser | | |
| Pagina offline senza rete, poi "Riprova" | | |
| Build firmata installata dallo store di test (Play closed test / TestFlight) | | |

Stato al 25/10/2026: APK debug compilato con JDK 21 e avviato su emulatore Android 16 (senza `CAP_SERVER_URL` mostra la pagina offline, come previsto). iOS non compilato: serve un Mac con Xcode.
