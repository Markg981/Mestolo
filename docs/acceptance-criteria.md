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
