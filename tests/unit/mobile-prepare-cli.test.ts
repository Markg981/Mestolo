import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const script = resolve('scripts/mobile-prepare.mjs');
const dir = mkdtempSync(join(tmpdir(), 'mobile-prepare-'));
mkdirSync(join(dir, 'mobile/www'), { recursive: true });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string>) {
  const clean = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' };
  return spawnSync(process.execPath, [script], { cwd: dir, env: { ...clean, ...env } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });
}

describe('mobile-prepare: CAP_SERVER_URL', () => {
  it('accetta https', () => {
    const r = run({ CAP_SERVER_URL: 'https://app.mestolo.it' });
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'mobile/www/config.js'), 'utf8')).toContain('https://app.mestolo.it');
  });
  it('rifiuta http senza CAP_ALLOW_HTTP', () => {
    expect(run({ CAP_SERVER_URL: 'http://192.168.1.5:3000' }).status).toBe(1);
  });
  it('accetta http con CAP_ALLOW_HTTP=1 (con avviso)', () => {
    const r = run({ CAP_SERVER_URL: 'http://192.168.1.5:3000', CAP_ALLOW_HTTP: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('not HTTPS');
  });
  it('rifiuta http nelle build store anche con CAP_ALLOW_HTTP=1', () => {
    expect(run({ CAP_SERVER_URL: 'http://app.mestolo.it', CAP_ALLOW_HTTP: '1', MOBILE_STORE_BUILD: '1' }).status).toBe(1);
  });
});
