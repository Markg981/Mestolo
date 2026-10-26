# Provider AI, OCR, traduzione e immagini

Mestolo funziona **anche senza alcun provider AI**. Le funzioni AI sono facoltative e passano da un'unica interfaccia (`src/lib/ai/providers.ts`), così un provider si può sostituire senza toccare le schermate.

| Funzione | Capacità richiesta | Anthropic | OpenAI | Compatibile OpenAI |
|---|---|---|---|---|
| Lettura foto (OCR/visione) | `vision` | ✅ | ✅ | se il modello supporta immagini |
| Analisi ricetta, sostituzioni, testo incollato | `text` | ✅ | ✅ | ✅ |
| Traduzione ricette | `text` (quota `translate`) | ✅ | ✅ | ✅ |
| Generazione immagini | `image` | ❌ | ✅ | ❌ |

## Chi paga: servizio base o chiave personale

Per ogni richiesta il server sceglie, in quest'ordine:

1. **la chiave personale dell'utente**, se ne ha salvata una adatta a quella funzione;
2. **il servizio base** del gestore (`AI_APP_*`), se configurato, entro le quote giornaliere per utente (`AI_DAILY_LIMIT_*`);
3. altrimenti la funzione risulta **non disponibile** e l'interfaccia offre il percorso manuale.

L'interfaccia mostra sempre prima dell'azione quale strada verrà usata ("Userà la tua chiave OpenAI…" oppure "Servizio base: 7 di 10 richieste rimaste oggi") e, per le immagini, chiede conferma esplicita.

## Configurare il servizio base (gestore)

```env
AI_APP_PROVIDER=anthropic          # oppure openai / openai-compatible
AI_APP_API_KEY=...
AI_APP_TEXT_MODEL=                 # vuoto = predefinito
AI_APP_VISION_MODEL=
AI_DAILY_LIMIT_TEXT=20
AI_DAILY_LIMIT_VISION=10
AI_DAILY_LIMIT_TRANSLATE=30
# Immagini (solo openai):
AI_APP_IMAGE_ENABLED=true
AI_APP_IMAGE_MODEL=gpt-image-1
```

### Import da video (trascrizione)

I link YouTube / Shorts / TikTok / Instagram Reels usano gratis descrizione e sottotitoli della
pagina (nessuna AI). Solo il caricamento di un file video usa la trascrizione audio:
l'audio e' estratto nel browser (mono 8 kHz, max 8 minuti, 4 MB) e inviato a
`POST {base}/audio/transcriptions`. Funziona con chiave personale OpenAI o con
`AI_APP_PROVIDER=openai` / `openai-compatible`; Anthropic non offre speech-to-text.

```
AI_TRANSCRIBE_MODEL=whisper-1   # default; consuma 1 unita' della quota giornaliera 'text'
```

Modelli predefiniti (sovrascrivibili, **verifica i nomi aggiornati nella documentazione del provider**): Anthropic `claude-sonnet-5-5`; OpenAI testo `gpt-5-mini`, immagini `gpt-image-1`.

### Endpoint compatibile OpenAI (self-hosted o terze parti)

```env
AI_APP_PROVIDER=openai-compatible
AI_APP_BASE_URL=http://mio-server:11434/v1     # es. Ollama, OpenRouter, Mistral, Groq
AI_APP_API_KEY=qualsiasi-valore-richiesto
AI_APP_TEXT_MODEL=llama3.1
AI_APP_VISION_MODEL=llava
```

Questa opzione esiste **solo per il gestore**: gli utenti non possono indicare URL arbitrari (sarebbe un vettore SSRF).

## Chiavi personali degli utenti

- Si inseriscono in *Impostazioni → AI e chiavi API* (provider `anthropic` o `openai`).
- Vengono cifrate con **AES-256-GCM** usando `APP_ENCRYPTION_KEY` (32 byte, conservata fuori dal database, es. nelle variabili di Vercel). Il testo cifrato è legato a utente e provider: copiato su un'altra riga non si decifra.
- La tabella `user_api_keys` non ha policy RLS: nessun client può leggerla. Il browser vede solo provider e ultime 4 cifre (`my_api_keys()`).
- Non compaiono in URL, log, analytics, risposte API o esportazioni. Gli errori dei provider vengono ripuliti con `redactSecrets` prima di qualsiasi log.
- L'utente può sostituirle o rimuoverle; per revocarle del tutto va disattivata anche nel pannello del provider.
- **Rotazione della chiave di cifratura**: 1) genera una nuova chiave (`npm run gen:key`); 2) imposta `APP_ENCRYPTION_KEY_PREVIOUS` = vecchia chiave e `APP_ENCRYPTION_KEY` = nuova, poi rilascia; 3) le chiavi utente si decifrano con la nuova o, in fallback, con la precedente, e vengono ri-cifrate con la nuova al primo uso; 4) quando non restano chiavi sotto la vecchia rimuovi `APP_ENCRYPTION_KEY_PREVIOUS`. Una chiave non decifrabile risulta "non disponibile" (e viene loggata): l'utente deve reinserirla.

### Termini dei provider

Prima di offrire il modello "porta la tua chiave", il gestore deve verificare che i termini attuali di ciascun provider consentano che una chiave venga usata da un'applicazione di terze parti per conto del suo titolare. Questa verifica non è stata fatta con valore legale durante lo sviluppo.

## Privacy

- **Foto per l'OCR**: elaborate in memoria (rotazione, rimozione metadati, ridimensionamento a 2000 px) e inviate solo al provider scelto; Mestolo non le salva.
- **Testo delle ricette**: per analisi, sostituzioni e traduzioni viene inviato il contenuto necessario della ricetta.
- I provider trattano questi dati secondo i propri termini e le proprie politiche di conservazione: indicale nella pagina privacy della tua installazione.
- I suggerimenti generati vengono salvati in `ai_suggestions`, leggibili solo dall'utente che li ha richiesti. Le traduzioni sono in cache per ricetta e lingua, leggibili da chi può vedere la ricetta e scrivibili solo dal server.

## Regole sui contenuti generati

- Estrazione: i prompt chiedono di **non inventare** quantità, unità, tempi o porzioni; l'output passa da uno schema zod tollerante e i valori mancanti restano vuoti con flag "Non rilevato" o "Da verificare".
- Analisi: suggerimenti tipizzati e applicabili uno per uno; le stime di tempo restano marcate come "Stima AI"; nessuna affermazione su salute o allergie.
- Traduzioni: il provider riceve solo i testi; quantità e unità vengono reinserite dall'originale, quindi una traduzione non può alterarle.
- Immagini: generate solo dopo conferma, salvate con tipo `ai_generated` ed etichettate "Immagine generata con AI".
