# Risposte per le schede privacy degli store (bozza)

Bozza basata su come funziona il codice. **Va verificata dal gestore** (che è il titolare del trattamento) prima dell'invio, in particolare per i provider AI e l'SMTP scelti.

## Dati raccolti

| Dato | Raccolto | Scopo | Collegato all'identità | Facoltativo |
|---|---|---|---|---|
| Email | Sì | Account, email di servizio (conferma, recupero) | Sì | No |
| Nome utente, nome visualizzato, bio | Sì | Profilo, ricerca amici | Sì | Nome e bio sì |
| Foto (immagini delle ricette caricate) | Sì | Funzionalità dell'app | Sì | Sì |
| Foto delle pagine per l'import | Elaborate, **non conservate** | Lettura del testo tramite il provider AI scelto | — | Sì |
| Contenuti generati dall'utente (ricette, note, raccolte, liste, piano) | Sì | Funzionalità dell'app | Sì | — |
| Preferenze alimentari dichiarate | Sì | Filtro della sezione Scopri | Sì | Sì |
| ID utente | Sì | Funzionamento del servizio | Sì | No |
| Conteggio uso funzioni AI | Sì | Quote giornaliere, trasparenza costi | Sì | — |
| Posizione | **No** (i metadati GPS delle foto vengono rimossi) | — | — | — |
| Contatti, cronologia di navigazione, dati finanziari, salute | **No** | — | — | — |
| Identificatori pubblicitari, tracciamento tra app | **No** | — | — | — |
| Analytics / crash reporting di terze parti | **No** (nessuno integrato) | — | — | — |

## Condivisione con terze parti
- **Supabase** (database, autenticazione, file): fornitore di infrastruttura (responsabile del trattamento).
- **Hosting** (es. Vercel): fornitore di infrastruttura.
- **Provider AI** (Anthropic/OpenAI/altro configurato), **solo quando l'utente usa una funzione AI**: testo della ricetta o foto delle pagine. Da dichiarare come condivisione per "funzionalità dell'app".
- **SMTP** (es. Resend): email di servizio.
- Nessuna vendita di dati, nessuna pubblicità.

## Sicurezza
- Dati cifrati in transito (HTTPS).
- Chiavi API personali cifrate a riposo (AES-256-GCM).
- L'utente può **richiedere l'eliminazione** dei dati: sì, direttamente in app (*Impostazioni → Account e dati*), con effetto immediato su account, ricette e file.
- **Esportazione** dei dati: sì, in JSON.

## Google Play – Sicurezza dei dati (corrispondenza)
- *Informazioni personali*: Email, Nome utente → raccolti, non condivisi (salvo fornitori), obbligatori.
- *Foto e video*: Foto → raccolte, facoltative; condivise con il provider AI solo su richiesta dell'utente.
- *Attività nell'app*: Altri contenuti generati dagli utenti → raccolti.
- *Identificatori dispositivo*: no.

## Apple – Privacy Nutrition Label (corrispondenza)
- *Contact Info → Email Address*: App Functionality, Linked to You.
- *User Content → Photos or Videos, Other User Content*: App Functionality, Linked to You.
- *Identifiers → User ID*: App Functionality, Linked to You.
- *Usage Data*: conteggio uso AI → App Functionality, Linked to You.
- *Tracking*: No.
