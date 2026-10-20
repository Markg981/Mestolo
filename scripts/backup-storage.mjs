// Downloads every file of the recipe-images bucket into a local directory.
// Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup-storage.mjs [outDir]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* file not present */
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.BACKUP_BUCKET ?? 'recipe-images';
const outDir = process.argv[2] ?? 'storage-backup';

if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from(bucketName);

// Lists a "folder" page by page; entries without an id are sub-folders.
async function* walk(prefix = '') {
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucket.list(prefix, { limit: pageSize, offset });
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id) yield path;
      else yield* walk(path);
    }
    if (data.length < pageSize) return;
  }
}

let count = 0;
for await (const path of walk()) {
  const { data, error } = await bucket.download(path);
  if (error) throw new Error(`download ${path}: ${error.message}`);
  const dest = join(outDir, bucketName, path);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await data.arrayBuffer()));
  count++;
}
console.log(`Downloaded ${count} files from "${bucketName}" into ${outDir}`);
