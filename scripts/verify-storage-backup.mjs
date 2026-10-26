// Verifies an extracted storage backup against its storage-manifest.json: every listed file must exist
// with the recorded size and sha256, and no unlisted file may be present. Exits non-zero on any mismatch.
// Usage: node scripts/verify-storage-backup.mjs <extractedDir>
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/verify-storage-backup.mjs <extractedDir>');
  process.exit(2);
}

const MANIFEST = 'storage-manifest.json';
let manifest;
try {
  manifest = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8'));
} catch (e) {
  console.error(`::error::${MANIFEST} mancante o illeggibile in ${dir}: ${e.message}`);
  process.exit(1);
}

async function* files(base, rel = '') {
  for (const e of await readdir(join(base, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* files(base, p);
    else yield p;
  }
}

let bad = 0;
const expected = new Set();
for (const f of manifest.files) {
  const key = `${f.bucket}/${f.path}`;
  expected.add(key);
  let buf;
  try {
    buf = await readFile(join(dir, f.bucket, f.path));
  } catch {
    console.error(`::error::${key}: file mancante nel backup`);
    bad++;
    continue;
  }
  const sha = createHash('sha256').update(buf).digest('hex');
  if (buf.length !== f.size || sha !== f.sha256) {
    console.error(`::error::${key}: size/hash diversi dal manifest (size ${buf.length}/${f.size})`);
    bad++;
  }
}
for await (const p of files(dir)) {
  if (p !== MANIFEST && !expected.has(p)) {
    console.error(`::error::${p}: file nel backup ma non nel manifest`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log(`Storage backup OK: ${manifest.files.length} files verified (size + sha256)`);
