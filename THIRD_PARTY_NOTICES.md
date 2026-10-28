# Avvisi sui componenti di terze parti

Mestolo è distribuito con licenza `UNLICENSED` (vedi `package.json`): la licenza del progetto non cambia e non si estende ai componenti qui elencati, che restano sotto le rispettive licenze.

## Asset OCR ridistribuiti

Lo script `scripts/copy-ocr-assets.mjs` copia in `public/ocr` (cartella generata e ignorata da git, ma servita dall'app e inclusa nelle build web e nei pacchetti mobile) i file seguenti. Le licenze sono quelle dichiarate nel campo `license` dei pacchetti in `node_modules` e nei file di licenza inclusi.

| File in `public/ocr` | Pacchetto npm | Versione | Licenza | Fonte della licenza |
| --- | --- | --- | --- | --- |
| `worker.min.js` | `tesseract.js` | 7.0.0 | Apache-2.0 | `node_modules/tesseract.js/LICENSE.md`, campo `license` di `package.json` |
| `core/tesseract-core*.wasm`, `core/tesseract-core*.wasm.js` | `tesseract.js-core` | 6.1.2 | Apache-2.0 | `node_modules/tesseract.js-core/LICENSE`, campo `license` di `package.json` |
| `lang/{ita,eng,deu,fra,spa,por}.traineddata.gz` | `@tesseract.js-data/{ita,eng,deu,fra,spa,por}` (cartella `4.0.0_best_int`) | 1.0.0 | MIT (pacchetto npm) | campo `license` di ciascun `package.json` |

Note:

- Il motore Tesseract OCR (compilato in WebAssembly in `tesseract.js-core`) e i modelli di lingua `tessdata_best` da cui derivano i file `.traineddata` sono del progetto Tesseract (https://github.com/tesseract-ocr), pubblicato con licenza Apache-2.0. I pacchetti `@tesseract.js-data/*` dichiarano MIT per il solo pacchetto di distribuzione e non includono un file di licenza dei modelli: la licenza Apache-2.0 dei modelli è quella del repository upstream `tesseract-ocr/tessdata_best` e non è verificabile dai soli pacchetti installati. Il gestore la confermi prima di una distribuzione commerciale.
- La licenza Apache-2.0 richiede di conservare il testo della licenza e gli avvisi di copyright. Il testo completo è nei file `LICENSE.md` / `LICENSE` dei pacchetti sopra, disponibili dopo `npm ci`; Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0 e MIT: https://opensource.org/license/mit.
- Per verificare di nuovo le licenze dopo un aggiornamento delle dipendenze: `npm ls tesseract.js tesseract.js-core` e lettura del campo `license` in `node_modules/<pacchetto>/package.json`.

## Altre dipendenze

Le altre dipendenze npm mantengono le proprie licenze, consultabili in `node_modules/<pacchetto>/package.json` e `package-lock.json`.
