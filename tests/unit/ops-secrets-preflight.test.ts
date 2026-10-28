import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// OPS-01: i workflow operativi devono fallire SUBITO e elencare TUTTI i secret mancanti in un solo ::error::
const WORKFLOWS: Record<string, string[]> = {
  "backup.yml": ["SUPABASE_DB_URL", "BACKUP_GPG_PUBLIC_KEY", "BACKUP_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  "restore-verify.yml": ["BACKUP_GPG_PRIVATE_KEY", "BACKUP_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  "ops-monitor.yml": ["BACKUP_S3_BUCKET", "SUPABASE_DB_URL"],
  "meal-reminders.yml": ["APP_URL", "CRON_SECRET"],
};

function read(file: string): string {
  return readFileSync(join(process.cwd(), ".github", "workflows", file), "utf8").replace(/\r\n/g, "\n");
}

describe("preflight dei secret nei workflow operativi", () => {
  for (const [file, secrets] of Object.entries(WORKFLOWS)) {
    it(`${file}: passo Preflight secrets con tutti i secret, prima dei passi pesanti`, () => {
      const text = read(file);
      const pre = text.indexOf("- name: Preflight secrets");
      expect(pre).toBeGreaterThan(-1);
      for (const s of secrets) expect(text.slice(pre)).toContain(s);
      // un solo messaggio cumulativo, non un exit al primo secret mancante
      expect(text).toContain('missing+=("$v")');
      expect(text).toContain("Secret mancanti");
      for (const heavy of ["actions/checkout", "npm ci", "apt-get", "pg_dump"]) {
        const i = text.indexOf(heavy);
        if (i !== -1) expect(pre).toBeLessThan(i);
      }
    });
  }

  it("ogni job con preflight lo ha come primo passo", () => {
    for (const file of Object.keys(WORKFLOWS)) {
      for (const m of read(file).matchAll(/^ {4}steps:\n( {6}- .*)\n/gm)) {
        if (file === "ops-monitor.yml" && m[1].includes("recent-success")) continue;
        expect(m[1], file).toMatch(/Preflight secrets|Check recent successful runs/);
      }
    }
  });
});
