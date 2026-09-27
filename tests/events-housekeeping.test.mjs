// events-housekeeping.test.mjs — legacy event history migrates without losing a line, and old
// months are pruned on a stated retention (CTC-3788, CTC-3790).
//
// Run: bun test tests/events-housekeeping.test.mjs
//
// Every case builds a scratch HOME with a resolved events directory (CATALYST_EVENTS_DIR) and a
// legacy ~/catalyst/events, and pins "now" to 2026-09-15.

import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { cutoffMonth, keepMonths, list, migrate, monthOf, prune } from "../vendor-src/scripts/events-housekeeping.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const T = mkdtempSync(join(tmpdir(), "events-hk-"));
afterAll(() => rmSync(T, { recursive: true, force: true }));
const NOW = new Date(Date.UTC(2026, 8, 15));

let n = 0;
function fixture() {
  const home = join(T, `h${++n}`);
  const events = join(home, ".local/state/catalyst/events");
  const legacy = join(home, "catalyst/events");
  mkdirSync(events, { recursive: true });
  mkdirSync(legacy, { recursive: true });
  const env = { HOME: home, CATALYST_EVENTS_DIR: events };
  const put = (dir, name, text = `${name}\n`) => writeFileSync(join(dir, name), text);
  return { home, events, legacy, env, put };
}
const names = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);

describe("month keys", () => {
  test("month files, rotated legacy files and ISO week files map to a month", () => {
    expect(monthOf("2026-09.jsonl")).toBe("2026-09");
    expect(monthOf("2026-09.jsonl.legacy")).toBe("2026-09");
    expect(monthOf("2026-02.jsonl.legacy.20260201T000000Z.4242")).toBe("2026-02"); // canonical-event.sh rotation
    expect(monthOf("2026-W01.jsonl")).toBe("2026-01"); // Sunday 2026-01-04
    expect(monthOf("2025-W01.jsonl")).toBe("2025-01"); // Sunday 2025-01-05
    expect(monthOf("2026-W34.jsonl")).toBe("2026-08");
    expect(monthOf("2026-W18.jsonl")).toBe("2026-05"); // Apr 27 – May 3: counts in May
    expect(monthOf("2026-02.jsonl.legacy.20260201T000000Z.42.1")).toBe("2026-02");
  });
  test("anything else is not an event file", () => {
    for (const name of ["2026-13.jsonl", "2026-09.json", "notes.txt", "tenant-0", "2026-W60.jsonl", "x2026-09.jsonl",
      "2026-07.jsonl.migrating", "2026-07.jsonl.legacy.20260701T000000Z.42.migrating", "2026-07.jsonl.legacy.junk"])
      expect(monthOf(name)).toBeNull();
  });
  test("the cutoff counts the current month as one of N", () => {
    expect(cutoffMonth("2026-09", 6)).toBe("2026-04");
    expect(cutoffMonth("2026-02", 3)).toBe("2025-12");
    expect(cutoffMonth("2026-09", 1)).toBe("2026-09");
  });
  test("retention: default 6, the variable, the flag over the variable, and refusals", () => {
    expect(keepMonths(undefined, {})).toBe(6);
    expect(keepMonths(undefined, { CATALYST_EVENTS_RETENTION_MONTHS: "3" })).toBe(3);
    expect(keepMonths("2", { CATALYST_EVENTS_RETENTION_MONTHS: "3" })).toBe(2);
    for (const bad of ["0", "-1", "1.5", "abc", "", "9".repeat(400)]) expect(() => keepMonths(bad, {})).toThrow();
    expect(keepMonths(undefined, { CATALYST_EVENTS_RETENTION_MONTHS: "" })).toBe(6);
  });
});

describe("prune", () => {
  test("deletes months before the retention in both directories and nothing else", () => {
    const f = fixture();
    for (const m of ["01", "02", "03", "04", "05", "06", "07", "08", "09"]) f.put(f.events, `2026-${m}.jsonl`);
    f.put(f.events, "2026-02.jsonl.legacy");
    f.put(f.events, "2026-W06.jsonl");
    f.put(f.events, "notes.txt");
    mkdirSync(join(f.events, "tenant-0"));
    f.put(f.legacy, "2025-12.jsonl");
    f.put(f.legacy, "2026-09.jsonl");
    const r = prune(f.env, { now: NOW });
    expect(r.oldestKept).toBe("2026-04");
    expect(names(f.events)).toEqual(["2026-04.jsonl", "2026-05.jsonl", "2026-06.jsonl", "2026-07.jsonl", "2026-08.jsonl", "2026-09.jsonl", "notes.txt", "tenant-0"]);
    expect(names(f.legacy)).toEqual(["2026-09.jsonl"]);
    expect(r.deleted).toHaveLength(6);
  });
  test("a retention of one month still keeps the current month", () => {
    const f = fixture();
    f.put(f.events, "2026-08.jsonl");
    f.put(f.events, "2026-09.jsonl");
    prune(f.env, { now: NOW, keep: "1" });
    expect(names(f.events)).toEqual(["2026-09.jsonl"]);
  });
  test("a week reaching into the current month is kept, even at a one-month retention", () => {
    const f = fixture();
    f.put(f.events, "2026-W18.jsonl");
    prune(f.env, { now: new Date(Date.UTC(2026, 4, 1)), keep: "1" });
    expect(names(f.events)).toEqual(["2026-W18.jsonl"]);
  });
  test("a future month is never deleted", () => {
    const f = fixture();
    f.put(f.events, "2026-10.jsonl");
    prune(f.env, { now: NOW, keep: "1" });
    expect(names(f.events)).toEqual(["2026-10.jsonl"]);
  });
  test("a dry run deletes nothing and reports what it would", () => {
    const f = fixture();
    f.put(f.events, "2025-01.jsonl");
    const r = prune(f.env, { now: NOW, dryRun: true });
    expect(r.deleted).toEqual([join(f.events, "2025-01.jsonl")]);
    expect(names(f.events)).toEqual(["2025-01.jsonl"]);
  });
});

describe("migrate", () => {
  test("moves old months, merges a month in both places legacy-first, leaves the current month", () => {
    const f = fixture();
    f.put(f.legacy, "2026-07.jsonl", "a\nb\n");
    f.put(f.legacy, "2026-08.jsonl", "old\n");
    f.put(f.events, "2026-08.jsonl", "new\n");
    f.put(f.legacy, "2026-09.jsonl", "live\n");
    const r = migrate(f.env, { now: NOW });
    expect(r).toMatchObject({ moved: ["2026-07.jsonl"], merged: ["2026-08.jsonl"], skippedCurrent: ["2026-09.jsonl"], failed: [] });
    expect(readFileSync(join(f.events, "2026-07.jsonl"), "utf8")).toBe("a\nb\n");
    expect(readFileSync(join(f.events, "2026-08.jsonl"), "utf8")).toBe("old\nnew\n");
    expect(names(f.legacy)).toEqual(["2026-09.jsonl"]);
    expect(names(f.events).filter((x) => x.includes(".tmp"))).toEqual([]);
  });
  test("a legacy month with no final newline keeps its last record whole when merged", () => {
    const f = fixture();
    f.put(f.legacy, "2026-08.jsonl", '{"a":1}');
    f.put(f.events, "2026-08.jsonl", '{"b":2}\n');
    expect(migrate(f.env, { now: NOW }).merged).toEqual(["2026-08.jsonl"]);
    expect(readFileSync(join(f.events, "2026-08.jsonl"), "utf8")).toBe('{"a":1}\n{"b":2}\n');
  });
  test("a rotated .legacy.<ts>.<pid> file migrates and is pruned like its month", () => {
    const f = fixture();
    f.put(f.legacy, "2026-07.jsonl.legacy.20260701T000000Z.42");
    f.put(f.legacy, "2025-01.jsonl.legacy.20250101T000000Z.42");
    migrate(f.env, { now: NOW });
    expect(names(f.events)).toEqual(["2025-01.jsonl.legacy.20250101T000000Z.42", "2026-07.jsonl.legacy.20260701T000000Z.42"]);
    prune(f.env, { now: NOW });
    expect(names(f.events)).toEqual(["2026-07.jsonl.legacy.20260701T000000Z.42"]);
  });
  test.skipIf(process.getuid?.() === 0)("a legacy dir that cannot be written fails before any copy, and a retry moves the month once", () => {
    const f = fixture();
    f.put(f.legacy, "2026-07.jsonl", "a\n");
    f.put(f.events, "2026-07.jsonl", "b\n");
    chmodSync(f.legacy, 0o555);
    try {
      const r = migrate(f.env, { now: NOW });
      expect(r.failed.map((x) => x.name)).toEqual(["2026-07.jsonl"]);
      expect(readFileSync(join(f.events, "2026-07.jsonl"), "utf8")).toBe("b\n");
      expect(names(f.legacy)).toEqual(["2026-07.jsonl"]);
    } finally {
      chmodSync(f.legacy, 0o755);
    }
    migrate(f.env, { now: NOW });
    migrate(f.env, { now: NOW });
    expect(readFileSync(join(f.events, "2026-07.jsonl"), "utf8")).toBe("a\nb\n");
  });
  test("a merged or moved month keeps the permissions of the log it replaces", () => {
    const f = fixture();
    f.put(f.legacy, "2026-07.jsonl", "a\n");
    f.put(f.legacy, "2026-08.jsonl", "b\n");
    f.put(f.events, "2026-08.jsonl", "c\n");
    chmodSync(join(f.legacy, "2026-07.jsonl"), 0o600);
    chmodSync(join(f.events, "2026-08.jsonl"), 0o600);
    migrate(f.env, { now: NOW });
    expect(statSync(join(f.events, "2026-07.jsonl")).mode & 0o777).toBe(0o600);
    expect(statSync(join(f.events, "2026-08.jsonl")).mode & 0o777).toBe(0o600);
  });
  test("private legacy records merged into a readable log stay private", () => {
    const f = fixture();
    f.put(f.legacy, "2026-08.jsonl", "secret\n");
    f.put(f.events, "2026-08.jsonl", "c\n");
    chmodSync(join(f.legacy, "2026-08.jsonl"), 0o600);
    chmodSync(join(f.events, "2026-08.jsonl"), 0o644);
    migrate(f.env, { now: NOW });
    expect(statSync(join(f.events, "2026-08.jsonl")).mode & 0o777).toBe(0o600);
  });
  test("a staged file left by an interrupted migration is reported, never merged again", () => {
    const f = fixture();
    f.put(f.legacy, "2026-07.jsonl.migrating", "a\n");
    f.put(f.events, "2026-07.jsonl", "a\n");
    const r = migrate(f.env, { now: NOW });
    expect(r.failed.map((x) => x.name)).toEqual(["2026-07.jsonl.migrating"]);
    expect(readFileSync(join(f.events, "2026-07.jsonl"), "utf8")).toBe("a\n");
    expect(list(f.env).filter((x) => x.stranded).map((x) => x.name)).toEqual(["2026-07.jsonl.migrating"]);
  });
  test("a destination that changes during a merge is not replaced, and the legacy month is restored", () => {
    const f = fixture();
    f.put(f.legacy, "2026-08.jsonl", "old\n");
    f.put(f.events, "2026-08.jsonl", "new\n");
    const target = join(f.events, "2026-08.jsonl");
    const r = migrate(f.env, { now: NOW, beforeReplace: (t) => appendFileSync(t, "late\n") });
    expect(r.failed.map((x) => x.name)).toEqual(["2026-08.jsonl"]);
    expect(readFileSync(target, "utf8")).toBe("new\nlate\n");
    expect(readFileSync(join(f.legacy, "2026-08.jsonl"), "utf8")).toBe("old\n");
    expect(readdirSync(f.events).filter((x) => x.includes(".tmp"))).toEqual([]);
  });
  test("a temporary merge file left by a dead run is reclaimed", () => {
    const f = fixture();
    f.put(f.legacy, "2026-07.jsonl");
    f.put(f.events, "2026-06.jsonl.migrate-999999.tmp", "partial");
    const r = migrate(f.env, { now: NOW });
    expect(r.reclaimed).toEqual(["2026-06.jsonl.migrate-999999.tmp"]);
    expect(names(f.events)).toEqual(["2026-07.jsonl"]);
  });
  test("a month whose staging file survives an interrupted run is never renamed over it", () => {
    const f = fixture();
    f.put(f.legacy, "2026-07.jsonl.migrating", "only copy\n");
    f.put(f.legacy, "2026-07.jsonl", "recreated\n");
    const r = migrate(f.env, { now: NOW });
    expect(r.failed.map((x) => x.name).sort()).toEqual(["2026-07.jsonl", "2026-07.jsonl.migrating"]);
    expect(readFileSync(join(f.legacy, "2026-07.jsonl.migrating"), "utf8")).toBe("only copy\n");
    expect(readFileSync(join(f.legacy, "2026-07.jsonl"), "utf8")).toBe("recreated\n");
  });
  test("a second run is a no-op", () => {
    const f = fixture();
    f.put(f.legacy, "2026-07.jsonl");
    migrate(f.env, { now: NOW });
    const again = migrate(f.env, { now: NOW });
    expect(again).toMatchObject({ moved: [], merged: [], failed: [] });
    expect(readFileSync(join(f.events, "2026-07.jsonl"), "utf8")).toBe("2026-07.jsonl\n");
  });
  test("an emptied legacy directory is removed", () => {
    const f = fixture();
    f.put(f.legacy, "2026-07.jsonl");
    migrate(f.env, { now: NOW });
    expect(existsSync(f.legacy)).toBe(false);
  });
  test("nothing happens when the resolved directory is the legacy one", () => {
    const f = fixture();
    f.put(f.legacy, "2026-07.jsonl");
    const r = migrate({ HOME: f.home, CATALYST_EVENTS_DIR: f.legacy }, { now: NOW });
    expect(r).toMatchObject({ moved: [], merged: [] });
    expect(names(f.legacy)).toEqual(["2026-07.jsonl"]);
  });
  test("a dry run moves nothing", () => {
    const f = fixture();
    f.put(f.legacy, "2026-07.jsonl");
    expect(migrate(f.env, { now: NOW, dryRun: true }).moved).toEqual(["2026-07.jsonl"]);
    expect(names(f.legacy)).toEqual(["2026-07.jsonl"]);
    expect(names(f.events)).toEqual([]);
  });
});

describe("CLI", () => {
  const cli = (env, ...args) =>
    spawnSync(process.execPath, [join(repoRoot, "vendor-src/scripts/events-housekeeping.mjs"), ...args], {
      env: { PATH: process.env.PATH, ...env },
      encoding: "utf8",
    });
  test("run migrates then prunes, and reports JSON", () => {
    const f = fixture();
    f.put(f.legacy, "2020-01.jsonl");
    const r = cli(f.env, "run", "--json");
    expect(r.status).toBe(0);
    const [m, p] = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
    expect(m.moved).toEqual(["2020-01.jsonl"]);
    expect(p.deleted).toEqual([join(f.events, "2020-01.jsonl")]);
  });
  test("a bad retention exits 2 and deletes nothing", () => {
    const f = fixture();
    f.put(f.events, "2020-01.jsonl");
    const r = cli({ ...f.env, CATALYST_EVENTS_RETENTION_MONTHS: "0" }, "prune");
    expect(r.status).toBe(2);
    expect(names(f.events)).toEqual(["2020-01.jsonl"]);
  });
  test("run with a bad retention refuses before migrating anything", () => {
    const f = fixture();
    f.put(f.legacy, "2020-01.jsonl");
    expect(cli(f.env, "run", "--keep-months", "0").status).toBe(2);
    expect(names(f.legacy)).toEqual(["2020-01.jsonl"]);
    expect(names(f.events)).toEqual([]);
  });
  test("--keep-months with no value refuses and deletes nothing", () => {
    const f = fixture();
    f.put(f.events, "2020-01.jsonl");
    for (const args of [["prune", "--keep-months"], ["prune", "--keep-months", "--dry-run"]]) {
      expect(cli(f.env, ...args).status).toBe(2);
    }
    expect(names(f.events)).toEqual(["2020-01.jsonl"]);
  });
  test("with HOME unset, housekeeping refuses instead of pruning a relative catalyst/events", () => {
    const f = fixture();
    const cwd = join(f.home, "cwd");
    mkdirSync(join(cwd, "catalyst/events"), { recursive: true });
    writeFileSync(join(cwd, "catalyst/events/2020-01.jsonl"), "x\n");
    const r = spawnSync(process.execPath, [join(repoRoot, "vendor-src/scripts/events-housekeeping.mjs"), "prune"], {
      env: { PATH: process.env.PATH, CATALYST_EVENTS_DIR: f.events },
      cwd,
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
    expect(existsSync(join(cwd, "catalyst/events/2020-01.jsonl"))).toBe(true);
  });
  test("an unknown verb exits 2", () => {
    expect(cli(fixture().env, "vacuum").status).toBe(2);
  });
});
