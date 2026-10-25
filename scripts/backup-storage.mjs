// Downloads every file of the storage buckets (recipe-images, which also holds the cook-log photos, and avatars) into a local directory.
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
const bucketNames = (process.env.BACKUP_BUCKETS ?? 'recipe-images,avatars').split(',').map((b) => b.trim()).filter(Boolean);
const outDir = process.argv[2] ?? 'storage-backup';

if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const client = createClient(url, key, { auth: { persistSession: false } });

// Lists a "folder" page by page; entries without an id are sub-folders.
async function* walk(bucket, prefix = '') {
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucket.list(prefix, { limit: pageSize, offset });
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id) yield path;
      else yield* walk(bucket, path);
    }
    if (data.length < pageSize) return;
  }
}

for (const bucketName of bucketNames) {
  const bucket = client.storage.from(bucketName);
  let count = 0;
  for await (const path of walk(bucket)) {
    const { data, error } = await bucket.download(path);
    if (error) throw new Error(`download ${bucketName}/${path}: ${error.message}`);
    const dest = join(outDir, bucketName, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await data.arrayBuffer()));
    count++;
  }
  console.log(`Downloaded ${count} files from "${bucketName}" into ${outDir}`);
}
