import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const vercelCron = (file: string, path: string) =>
  (JSON.parse(read(file)) as { crons: { path: string; schedule: string }[] }).crons.find((c) => c.path === path)?.schedule;

/** Massimo intervallo in minuti tra due esecuzioni di un'espressione cron (solo le forme usate nel repo). */
function maxGapMinutes(expr: string): number {
  const [min, hour, dom, mon, dow] = expr.trim().split(/\s+/);
  if (dom !== '*' || mon !== '*' || dow !== '*') return Infinity;
  if (hour !== '*') return 24 * 60;
  if (min === '*') return 1;
  const step = /^\*\/(\d+)$/.exec(min);
  if (step && 60 % Number(step[1]) === 0) return Number(step[1]);
  return 60;
}

const ROUTE = '/api/cron/meal-reminders';
const WINDOW_DEFAULT = 45;

describe('scheduler dei promemoria dei pasti', () => {
  it('maxGapMinutes', () => {
    expect(maxGapMinutes('*/15 * * * *')).toBe(15);
    expect(maxGapMinutes('0 8 * * *')).toBe(1440);
    expect(maxGapMinutes('5 * * * *')).toBe(60);
  });

  it('vercel.pro.json chiama la route almeno ogni 15 minuti, entro la finestra di recupero', () => {
    const gap = maxGapMinutes(vercelCron('vercel.pro.json', ROUTE) ?? '');
    expect(gap).toBeLessThanOrEqual(15);
    expect(gap).toBeLessThan(WINDOW_DEFAULT);
  });

  it('con il cron Vercel giornaliero il workflow GitHub la chiama ogni 15 minuti', () => {
    const daily = maxGapMinutes(vercelCron('vercel.json', ROUTE) ?? '') > 15;
    if (!daily) return;
    const wf = read('.github/workflows/meal-reminders.yml');
    const cron = /cron:\s*'([^']+)'/.exec(wf)?.[1] ?? '';
    expect(maxGapMinutes(cron)).toBeLessThanOrEqual(15);
    expect(wf).toContain(ROUTE);
  });

  it('il workflow GitHub fallisce se mancano APP_URL o CRON_SECRET (niente run verdi a vuoto)', () => {
    const wf = read('.github/workflows/meal-reminders.yml');
    const guard = /if \[ -z "\$APP_URL" \] \|\| \[ -z "\$CRON_SECRET" \]; then([\s\S]*?)\n\s*fi\b/.exec(wf)?.[1] ?? '';
    expect(guard).toMatch(/exit 1/);
    expect(guard).not.toMatch(/exit 0/);
  });

  it('ops-monitor controlla i promemoria mai elaborati e l\'eta\' del backup', () => {
    const wf = read('.github/workflows/ops-monitor.yml');
    expect(wf).toContain('meal_reminders_sent');
    expect(wf).toMatch(/MAX_AGE_HOURS: 36/);
    expect(maxGapMinutes(/cron:\s*'([^']+)'/.exec(wf)?.[1] ?? '')).toBeLessThanOrEqual(24 * 60);
  });
});

describe('backup', () => {
  const wf = read('.github/workflows/backup.yml');

  it('i secret S3 e la chiave pubblica sono obbligatori su ogni run', () => {
    expect(wf).toMatch(/for v in SUPABASE_DB_URL BACKUP_GPG_PUBLIC_KEY BACKUP_S3_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do/);
  });

  it('non carica mai il dump come artifact (repository pubblico)', () => {
    for (const f of ['backup.yml', 'restore-verify.yml', 'ops-monitor.yml']) {
      const text = read(`.github/workflows/${f}`);
      // la guardia in backup.yml usa un pattern con classe di caratteri, quindi non si auto-segnala
      expect(text).not.toMatch(/uses:\s*actions\/upload-artifact/);
      expect(text).not.toMatch(/db-backup-|storage-backup-/);
      expect(text).not.toMatch(/gh run download/);
    }
    expect(wf).toContain("grep -nE 'upload-artifac[t]'");
  });

  it('cifra in modo asimmetrico, senza passphrase', () => {
    expect(wf).not.toMatch(/PASSPHRASE|--symmetric/);
    expect(read('scripts/backup-db.sh')).toContain('backup_encrypt');
    expect(read('scripts/lib/backup-gpg.sh')).toMatch(/--encrypt/);
    expect(read('scripts/lib/backup-gpg.sh')).not.toMatch(/--symmetric/);
  });
});
