import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const probes = readFileSync("scripts/lib/backup-probes.sh", "utf8");
const verify = readFileSync("scripts/restore-verify-db.sh", "utf8");

describe("sonde backup/restore (F-02)", () => {
  it("scopre le tabelle dinamicamente invece di un elenco fisso", () => {
    expect(probes).toContain("pg_class");
    expect(probes).toContain("query_to_xml");
    expect(probes).not.toMatch(/PROBE_(COUNT|HASH)_TABLES/);
  });

  it("calcola conteggio e hash per ogni tabella scoperta", () => {
    expect(probes).toContain("'count ' || s");
    expect(probes).toContain("'hash ' || s");
  });
});

describe("restore-verify-db.sh (F-02)", () => {
  it("non tollera piu gli errori di pg_restore con un semplice warning", () => {
    expect(verify).not.toMatch(/--dbname[^\n]*\|\| (true|echo)/);
    expect(verify).not.toContain("::warning::");
  });

  it("usa un restore bloccante con allow-list esplicita", () => {
    expect(verify).toContain("ALLOW_COMMON");
    expect(verify).toContain('restore_checked "public" "" "$work"/public-*.dump || exit 1');
  });

  it("verifica anche tabelle extra rispetto al manifest", () => {
    expect(verify).toContain("assente dal manifest");
  });
});
