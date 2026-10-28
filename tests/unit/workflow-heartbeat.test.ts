import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(join(process.cwd(), '.github', 'workflows', f), 'utf8');

describe('workflow: heartbeat esterno opzionale', () => {
  it.each([
    ['backup.yml', 'HEARTBEAT_URL_BACKUP'],
    ['meal-reminders.yml', 'HEARTBEAT_URL_MEAL_REMINDERS'],
    ['ops-monitor.yml', 'HEARTBEAT_URL_OPS_MONITOR'],
  ])('%s pinga %s solo a run riuscito e senza fallire se manca', (file, secret) => {
    const text = read(file);
    expect(text).toContain(`HEARTBEAT_URL: \${{ secrets.${secret} }}`);
    const block = text.slice(text.indexOf('Heartbeat esterno'));
    expect(block).toMatch(/if: success\(\)/);
    expect(block).toMatch(/\[ -z "\$HEARTBEAT_URL" \][\s\S]*exit 0/);
    expect(block).toMatch(/\|\| echo "::warning::/);
  });

  it('ops-monitor: il job heartbeat dipende da tutti i controlli', () => {
    const text = read('ops-monitor.yml');
    expect(text).toMatch(/heartbeat:\s+needs: \[backup-age, missed-reminders, recent-success\]/);
  });
});
