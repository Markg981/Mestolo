# Fase 5 - Lancio sugli store: piano operativo

Checklist dal primo build alla release in produzione. Per build, firma e CI delle app vedi [docs/mobile.md](mobile.md); per schede store, screenshot e testi vedi [store/README.md](../store/README.md).

Durata indicativa: 4-5 settimane (14 giorni di closed test Play sono il vincolo minimo; la revisione Apple e la raccolta dati aggiungono margine).

## 1. Account e prerequisiti

- [ ] Account Google Play Console (sviluppatore organizzazione o personale, verifica identità completata, 25 USD una tantum).
- [ ] Account Apple Developer Program (99 USD/anno) e accesso ad App Store Connect.
- [ ] Bundle id / application id definiti e identici in Play, App Store Connect e Capacitor (vedi docs/mobile.md).
- [ ] Informativa privacy e termini raggiungibili da URL pubblico (`/privacy`, `/terms`); indirizzo di supporto attivo.
- [ ] Almeno un account moderatore (`profiles.is_moderator = true`, assegnato via SQL) per leggere i feedback in `/moderation/feedback`.
- [ ] Migrazione `20261025014000_app_feedback.sql` applicata in produzione prima di invitare i tester.
- [ ] Monitoraggio errori attivo e dashboard per le metriche della sezione 7.

## 2. Primo build

- [ ] Build Android firmato (AAB) e build iOS (archive) prodotti dalla CI secondo docs/mobile.md.
- [ ] Verifica manuale su dispositivo reale: login, importazione da link, salvataggio ricetta, modalità cucina, invio feedback (la scheda feedback deve indicare la piattaforma corretta).
- [ ] Il campo versione mostrato nel feedback coincide con la versione del build (`NEXT_PUBLIC_APP_VERSION`).

## 3. Google Play: closed test (12 tester, 14 giorni consecutivi)

Requisito Google per i nuovi account personali: almeno 12 tester con opt-in attivo per 14 giorni consecutivi prima di richiedere l'accesso alla produzione. Se un tester esce, il conteggio va ripristinato a 12: puntare a 15-20 iscritti.

### 3.1 Preparazione

- [ ] Creare l'app in Play Console, compilare le sezioni obbligatorie (Data safety, classificazione contenuti, pubblico di destinazione, annunci: no).
- [ ] Creare un Google Group (es. `mestolo-tester@googlegroups.com`), impostato su "chiunque può chiedere di entrare" con approvazione manuale.
- [ ] In Play Console: Test > Closed testing > crea traccia, aggiungere il Google Group come lista tester, caricare l'AAB e pubblicare la release del test.
- [ ] Copiare il link di opt-in (formato `https://play.google.com/apps/testing/<application id>`).

### 3.2 Reclutamento

- [ ] Elenco di almeno 20 persone (amici, famiglia, colleghi, community di cucina), con preferenza per chi usa spesso ricette online.
- [ ] Messaggio di invito: cos'è Mestolo, cosa chiediamo (5 minuti al giorno per 14 giorni), link al Google Group da iscrivere con lo stesso account Google usato sul telefono, poi link di opt-in e installazione.
- [ ] Ogni tester deve: unirsi al gruppo, aprire il link di opt-in, scegliere "Diventa tester", installare dal Play Store e creare un account in app.
- [ ] Tenere un foglio di tracciamento: nome, email Google, data opt-in, ultimo giorno attivo, feedback inviati.
- [ ] Giorno 1 = quando i 12 tester risultano tutti iscritti; il conteggio dei 14 giorni parte da lì.

### 3.3 Cosa chiedere ai tester ogni giorno

Mandare un promemoria breve (messaggio o email) con il compito del giorno. Il giorno non va saltato: i tester devono restare opt-in e aprire l'app.

| Giorni | Compito |
| --- | --- |
| 1 | Registrarsi, completare il profilo, salvare la prima ricetta (annotare quanto ci si mette). |
| 2 | Importare 3 ricette da link di siti italiani che si usano davvero. |
| 3 | Importare una ricetta da foto o testo incollato. |
| 4 | Aprire una ricetta in modalità cucina e cucinarla davvero. |
| 5 | Usare lista della spesa e dispensa. |
| 6 | Generare un piano settimanale. |
| 7 | Provare l'assistente di cucina e le sostituzioni. |
| 8 | Provare la condivisione (collezione, amico, pagina pubblica). |
| 9 | Usare l'app offline (modalità aereo) e poi riconnettersi. |
| 10 | Provare la ricerca e i filtri. |
| 11 | Cambiare lingua e controllare le traduzioni. |
| 12 | Cucinare una seconda ricetta in modalità cucina. |
| 13 | Libero: usare l'app come farebbe normalmente. |
| 14 | Inviare un feedback generale (cosa tieni, cosa cambieresti). |

Ogni giorno: aprire l'app almeno una volta e, se qualcosa non va, inviare un feedback.

### 3.4 Raccolta feedback con la funzione in app

- I tester usano Impostazioni > Invia feedback (tipo: problema, idea, altro). Piattaforma e versione sono allegate in automatico; limite 10 messaggi al giorno.
- Il moderatore legge `/moderation/feedback` (newest first), filtra per stato e segna Visto / Risolto. Obiettivo: ogni feedback "Nuovo" visto entro 24 ore.
- Triage settimanale: bug bloccanti = fix e nuova release nella traccia chiusa; idee = backlog.
- Il Google Group serve solo per i problemi di installazione; tutto il resto passa dall'app, così il contesto è già completo.
- Tenere i numeri per il go/no-go: feedback per tipo, bug aperti, tester attivi per giorno.

### 3.5 Chiusura

- [ ] 14 giorni consecutivi con almeno 12 tester opt-in confermati nella dashboard Play.
- [ ] Compilare il questionario di accesso alla produzione in Play Console (come è stato condotto il test, feedback ricevuti, modifiche fatte).
- [ ] Attendere l'approvazione di Google (di norma pochi giorni).

## 4. Apple: TestFlight

- [ ] App creata in App Store Connect con lo stesso bundle id; build caricata dalla CI iOS (vedi docs/mobile.md).
- [ ] Test interno: team (fino a 100 persone), nessuna revisione, subito disponibile.
- [ ] Test esterno: creare un gruppo, aggiungere tester per email o link pubblico (fino a 10.000), compilare "Informazioni sul test" (cosa provare, contatto, note per la revisione).
- [ ] La prima build esterna passa la Beta App Review (di solito 1-2 giorni). Le build successive della stessa versione spesso non la richiedono.
- [ ] I tester usano gli stessi compiti della sezione 3.3 e lo stesso modulo in app; da TestFlight possono anche inviare screenshot con feedback.
- [ ] Le build TestFlight scadono dopo 90 giorni: non lasciare passare troppo tempo prima della release.

## 5. Checklist scheda store

Testi, screenshot e asset sono in [store/README.md](../store/README.md). Prima dell'invio verificare:

- [ ] Nome, sottotitolo, descrizione breve e lunga nelle lingue supportate (almeno italiano e inglese).
- [ ] Screenshot per tutte le dimensioni richieste (telefono; tablet se richiesto; iPhone 6.7" e 6.5", iPad se supportato).
- [ ] Icona 512 px (Play) e 1024 px (Apple), immagine in evidenza Play (1024x500).
- [ ] Categoria (Cibo e bevande), classificazione età, contatto di supporto, URL privacy.
- [ ] Data safety (Play) e Privacy nutrition labels (Apple) coerenti con quanto fa davvero l'app: account, contenuti dell'utente, chiavi AI personali cifrate, notifiche, nessun tracciamento pubblicitario.
- [ ] Dichiarazione dei contenuti generati dagli utenti: segnalazione, blocco utenti, moderazione (già presenti in app).
- [ ] Eliminazione account raggiungibile in app (Impostazioni > Account) e dichiarata nei form degli store.

## 6. Note per la revisione

- **Account demo**: creare un utente di prova con ricette già salvate e fornire email e password nelle note per i revisori (Apple e Play).
- **Cosa fa l'app**: raccoglie ricette da link, foto e testo, le organizza e guida la cucina passo passo.
- **Funzioni AI**: opzionali; l'app funziona senza. Spiegare che le chiavi personali sono cifrate e che il piano base usa una quota limitata.
- **Contenuti utente**: indicare dove si segnala e si blocca (menu ricetta e profilo) e che esiste moderazione.
- **Permessi**: fotocamera (solo per importare una foto di ricetta), notifiche (solo promemoria scelti dall'utente).
- **Funzioni che richiedono rete**: l'app carica il sito; senza connessione mostra le ricette già aperte.
- Rispondere alle domande dei revisori entro 24 ore; una bocciatura è tipicamente una richiesta di chiarimento, non definitiva.

## 7. Criteri go/no-go per la produzione

Si pubblica solo se tutti i criteri sono soddisfatti sui dati del periodo di test (closed test Play + TestFlight). Se uno fallisce: correggere, rilasciare nuova build di test e rimisurare per almeno 7 giorni.

| # | Metrica | Soglia | Come si misura |
| --- | --- | --- | --- |
| 1 | Tempo alla prima ricetta salvata | entro 2 minuti dal primo accesso per almeno l'80% dei nuovi tester | differenza tra `profiles.created_at` e la prima `recipes.created_at` dello stesso utente |
| 2 | Successo importazione da link | oltre 90% sui 50 siti di ricette italiani più usati | lista fissa di 50 URL (uno per sito) lanciata prima del rilascio; successo = ricetta con titolo, ingredienti e passaggi |
| 3 | Uso della modalità cucina | almeno una ricetta aperta in modalità cucina a settimana per utente attivo | `cook_logs` / eventi di apertura, per settimana, sugli utenti attivi |
| 4 | Costo AI per utente attivo | sotto 0,10 EUR al mese per utente attivo (soglia iniziale, da confermare con i costi reali del provider) | somma dei costi delle chiamate AI del mese / utenti attivi del mese |
| 5 | Accessi non autorizzati | zero: tutta la suite di test RLS (`tests/db`) verde in CI e nessun caso nei feedback | esito CI sulla build candidata + revisione dei feedback di tipo problema |

Criteri di qualità aggiuntivi (blocchi indipendenti dalle metriche):

- [ ] Nessun bug bloccante aperto nel pannello feedback (stato Nuovo o Visto con gravità alta).
- [ ] Nessun crash ricorrente nel monitoraggio degli errori.
- [ ] Almeno 12 tester per 14 giorni consecutivi (Play) e approvazione della produzione ricevuta.
- [ ] Beta App Review superata e revisione finale Apple inviata.

Decisione: go se tutti i criteri sono verdi; no-go se manca uno qualsiasi dei 5 criteri o un blocco. Registrare data, valori misurati e decisione in fondo a questo file.

## 8. Rilascio in produzione

- [ ] Play: promuovere la release dalla traccia chiusa alla produzione, partendo da un rollout graduale (es. 10% poi 50% poi 100%) e osservando errori e feedback a ogni passo.
- [ ] Apple: selezionare la build TestFlight approvata, inviare per la revisione, scegliere rilascio manuale per sincronizzarsi con Play.
- [ ] Annunciare ai tester e agli amici, con link agli store.
- [ ] Prime due settimane: controllare ogni giorno `/moderation/feedback` e il monitoraggio errori; hotfix rapidi se serve.
- [ ] Ripetere le misure della sezione 7 a 30 giorni dal lancio.

## Registro decisione

| Data | Valori misurati | Decisione | Note |
| --- | --- | --- | --- |
| | | | |
