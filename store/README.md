# Schede degli store

Metadati per Google Play e App Store, in un layout compatibile con fastlane (`supply` / `deliver`) ma senza dipendere da fastlane: si possono anche copiare a mano nelle console.

## Struttura

```
store/
  android/
    feature-graphic.png            Grafica in evidenza Play, 1024x500 (generata e committata)
    <locale>/
      title.txt                    Titolo, max 30
      short_description.txt        Descrizione breve, max 80
      full_description.txt         Descrizione completa, max 4000
      changelogs/default.txt       Novità della versione, max 500
  ios/
    <locale>/
      name.txt                     Nome, max 30
      subtitle.txt                 Sottotitolo, max 30
      keywords.txt                 Parole chiave, max 100, separate da virgola senza spazi
      promotional_text.txt         Testo promozionale, max 170
      description.txt              Descrizione, max 4000
      release_notes.txt            Novità, max 4000
      privacy_url.txt              URL privacy
      support_url.txt              URL assistenza
  screenshots/                     Output dello script (ignorato da git)
```

Lingue presenti: `it-IT` (principale) ed `en-US`. Per aggiungerne una si copia la cartella di un locale in entrambe le piattaforme e si traduce; il test `tests/unit/store-listings.test.ts` verifica che i file ci siano, non siano vuoti e rispettino i limiti.

Gli URL usano il segnaposto `{{SITE_URL}}` (l'URL pubblico del sito, senza slash finale, lo stesso di `NEXT_PUBLIC_SITE_URL`). Va sostituito prima dell'invio, ad esempio:

```
sed -i "s#{{SITE_URL}}#https://mestolo.example#g" store/ios/*/privacy_url.txt store/ios/*/support_url.txt
```

Non committare la versione sostituita.

## Rigenerare le risorse

- Grafica in evidenza: `npm run store:graphic` (usa `public/icon.svg` e il colore `#2a1a2e`).
- Screenshot, con il sito già in esecuzione e un account demo:

```
STORE_BASE_URL=https://mestolo.example STORE_EMAIL=demo@... STORE_PASSWORD=... npm run store:screenshots
```

Variabili facoltative: `STORE_LOCALES` (default `it-IT,en-US`), `STORE_PLATFORMS` (`android,ios-69,ios-65`), `STORE_RECIPE_ID` (la ricetta per le schermate di dettaglio e cucina; altrimenti la prima della lista).

Dimensioni prodotte: Play 1080x1920, iPhone 6.9" 1320x2868, iPhone 6.5" 1284x2778, in `store/screenshots/<piattaforma>/<locale>/`. Lo script non fa parte di `npm run test:e2e`.

L'account demo dovrebbe avere alcune ricette con foto, un piano settimanale, una lista della spesa con articoli di reparti diversi e qualche elemento in dispensa, nella lingua del locale che si cattura (le ricette non vengono tradotte). Gli screenshot vanno guardati prima di caricarli.

## Caricamento manuale

**Google Play Console** → Presenza nello store → Scheda dello store principale: titolo, descrizione breve e completa, icona 512 (`public/icons/icon-512.png`), grafica in evidenza, screenshot del telefono (da 2 a 8). Altre lingue in "Gestisci traduzioni". Le novità si inseriscono al momento della creazione della release.

**App Store Connect** → la versione dell'app → per ogni lingua: testo promozionale, descrizione, parole chiave, URL di assistenza, novità; nome e sottotitolo in "Informazioni app"; URL privacy in "Privacy dell'app". Screenshot nelle sezioni 6.9" e 6.5".

## Revisione: account demo

Entrambi gli store chiedono credenziali per l'accesso. Serve un account già confermato (senza passaggi via email), con dati di esempio come sopra, e con le funzioni AI utilizzabili: per questo l'account demo deve avere una chiave API configurata in Impostazioni → IA, oppure il provider del gestore attivo. Inserire le credenziali in "Accesso all'app" (Play) e "Informazioni per la revisione" (App Store), con una nota che indica che l'importazione da foto e video e l'assistente usano un servizio di IA. L'eliminazione dell'account è in Impostazioni → Account e dati.

## Classificazione dei contenuti e fascia d'età

Risposte coerenti con `docs/store-privacy.md`; da verificare dal gestore prima dell'invio.

- **Contenuti generati dagli utenti: sì.** Gli utenti pubblicano ricette, foto, note e profili visibili ad altri. Misure presenti: segnalazione dei contenuti, moderazione, possibilità di bloccare/rimuovere, eliminazione dell'account (richiesta da Apple 5.1.1 e dalla policy UGC di Play).
- **Intelligenza artificiale generativa: sì.** Importazione da foto e video, assistente di cucina e generatore di piano usano un provider esterno; il testo della ricetta o la foto vengono inviati solo quando l'utente usa la funzione. Su Play, dichiarare un'app con funzioni di IA generativa e indicare il canale di segnalazione dei contenuti.
- **Violenza, contenuti sessuali, linguaggio volgare, droghe, gioco d'azzardo, orrore, temi maturi:** nessuno/a.
- **Alcol, tabacco, droghe:** nessun contenuto promozionale; le ricette possono citare vino o liquori come ingredienti (indicare "nessuno" o "sporadico, a scopo culinario" a seconda del questionario).
- **Acquisti in app, pubblicità, tracciamento:** no.
- **Posizione:** no. **Contatti, salute, finanza:** no.
- **Accesso senza restrizioni al web:** no. **Chat tra utenti:** no.
- **Fascia d'età risultante attesa:** 4+ su Apple (con l'eventuale voce UGC può salire a 12+ su alcuni questionari); Play: PEGI 3 / Tutti, con la nota "contenuti generati dagli utenti".
- **Pubblico di destinazione (Play):** adulti e ragazzi dai 13 anni; non è un'app per bambini.
