// Scrive public/sw-build.js con l'id della build, importato da public/sw.js (finding E-01).
// Cosi il nome della cache statica cambia a ogni deploy e le cache vecchie vengono cancellate in activate.
// public/sw.js resta byte-identico fra i deploy (no-cache); cambia solo questo file, anch'esso servito no-cache.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function resolveBuildId() {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.BUILD_ID;
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return String(Date.now());
  }
}

const id = resolveBuildId().replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || String(Date.now());
writeFileSync(new URL('../public/sw-build.js', import.meta.url), `self.MESTOLO_BUILD_ID = ${JSON.stringify(id)};\n`);
console.log(`sw-build.js: build id ${id}`);
