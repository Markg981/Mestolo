// Copies the Tesseract.js worker, WASM core and traineddata into public/ocr so OCR is
// self-hosted (no CDN, strict CSP). Runs before dev and build; output is git-ignored.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = join('public', 'ocr');
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

cpSync(join('node_modules', 'tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js'));

const core = join('node_modules', 'tesseract.js-core');
for (const f of readdirSync(core)) {
  if (f.startsWith('tesseract-core') && (f.endsWith('.wasm.js') || f.endsWith('.wasm'))) cpSync(join(core, f), join(out, 'core', f));
}

for (const l of ['ita', 'eng', 'deu', 'fra', 'spa', 'por']) {
  const src = join('node_modules', '@tesseract.js-data', l, '4.0.0_best_int', `${l}.traineddata.gz`);
  if (!existsSync(src)) throw new Error(`Missing OCR language data: ${src}`);
  cpSync(src, join(out, 'lang', `${l}.traineddata.gz`));
}
