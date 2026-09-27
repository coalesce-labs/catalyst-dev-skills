// events-dir.test.mjs — every event producer lands where the paths contract says (CTC-3787).
//
// Run: bun test tests/events-dir.test.mjs
//
// Each case runs a real producer with a scratch HOME and no inherited CATALYST_* or XDG_* value,
// then reads the month file it wrote. The producers: execution-core's getEventLogPath,
// canonical-event.sh's append seam and its sentinel guard, emit-reap-intent.sh and
// linear-read-replica.sh.

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
// Every case spawns shells; under run-tests.sh the suites run in parallel and the 5 s default is tight.
setDefaultTimeout(30000);
const LIB = join(repoRoot, "vendor-src/scripts/lib");
const T = mkdtempSync(join(tmpdir(), "events-dir-"));
afterAll(() => rmSync(T, { recursive: true, force: true }));

const now = new Date();
const MONTH = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}.jsonl`;
let n = 0;
function scratch() {
  const home = join(T, `home-${++n}`);
  mkdirSync(home, { recursive: true });
  return home;
}
function manifest(home, events) {
  const file = join(home, "paths.json");
  const p = (x) => join(home, x);
  writeFileSync(file, JSON.stringify({
    version: 1,
    paths: { repoRoot: p("r"), worktrees: p("w"), logs: p("l"), events, config: p("c"), cache: p("k"), state: p("s"), skills: p("sk"), replicaDb: p("replica.db") },
    provenance: {},
  }));
  return file;
}
function bash(home, script, env = {}) {
  return spawnSync("bash", ["-c", script], { env: { PATH: process.env.PATH, HOME: home, ...env }, encoding: "utf8" });
}
const lines = (dir) => (existsSync(join(dir, MONTH)) ? readFileSync(join(dir, MONTH), "utf8").trim().split("\n") : []);
const legacy = (home) => join(home, "catalyst/events");

describe("execution-core getEventLogPath", () => {
  const run = (home, env) =>
    spawnSync(process.execPath, ["-e", `import("${join(repoRoot, "vendor-src/scripts/execution-core/config.mjs")}").then(m => process.stdout.write(m.getEventLogPath() + "\\n" + m.getRunsRoot()))`], {
      env: { PATH: process.env.PATH, HOME: home, ...env },
      encoding: "utf8",
    }).stdout.split("\n");

  test("CATALYST_EVENTS_DIR names the log", () => {
    const home = scratch();
    expect(run(home, { CATALYST_EVENTS_DIR: "/v/events" })[0]).toBe(`/v/events/${MONTH}`);
  });
  test("the manifest names it when no variable does", () => {
    const home = scratch();
    expect(run(home, { CATALYST_PATHS_FILE: manifest(home, "/m/events") })[0]).toBe(`/m/events/${MONTH}`);
  });
  test("the default is ~/.local/state/catalyst/events, and runs go under state", () => {
    const home = scratch();
    expect(run(home, {})).toEqual([`${home}/.local/state/catalyst/events/${MONTH}`, `${home}/.local/state/catalyst/runs`]);
  });
  test("CATALYST_DIR still isolates a test (CTL-810)", () => {
    const home = scratch();
    expect(run(home, { CATALYST_DIR: "/d" })).toEqual([`/d/events/${MONTH}`, "/d/runs"]);
  });
});

describe("canonical-event.sh sentinel guard", () => {
  const sentinel = JSON.stringify({ resource: { "catalyst.orchestration": "orch-test" }, attributes: {} });
  const append = (home, dir, env = {}) =>
    bash(home, `source '${LIB}/canonical-event.sh'; canonical_jsonl_append '${dir}' '${sentinel}'`, env);

  test("a sentinel aimed at the resolved default log is dropped", () => {
    const home = scratch();
    const dir = join(home, ".local/state/catalyst/events");
    append(home, dir);
    expect(lines(dir)).toEqual([]);
  });
  test("a sentinel aimed at the manifest's log is dropped, even while a test override is set", () => {
    const home = scratch();
    const dir = join(home, "declared-events");
    append(home, dir, { CATALYST_PATHS_FILE: manifest(home, dir), CATALYST_EVENTS_DIR: join(home, "scratch") });
    expect(lines(dir)).toEqual([]);
  });
  test("a sentinel aimed at the legacy ~/catalyst/events is dropped", () => {
    const home = scratch();
    append(home, legacy(home));
    expect(lines(legacy(home))).toEqual([]);
  });
  test("control: a sentinel aimed at a scratch dir is written", () => {
    const home = scratch();
    const dir = join(home, "scratch");
    append(home, dir);
    expect(lines(dir)).toHaveLength(1);
  });
});

describe("shell producers", () => {
  const reap = (home, env) =>
    bash(home, `source '${LIB}/emit-reap-intent.sh'; emit_reap_intent orphans.reap-requested --ticket CTC-1`, env);
  const read = (home, env) =>
    bash(home, `source '${LIB}/linear-read-replica.sh'; _lrr_emit_read_event CTC-1 replica ok 5`, env);

  for (const [name, produce] of [["emit-reap-intent.sh", reap], ["linear-read-replica.sh", read]]) {
    test(`${name}: CATALYST_EVENTS_DIR`, () => {
      const home = scratch();
      const dir = join(home, "v");
      produce(home, { CATALYST_EVENTS_DIR: dir });
      expect(lines(dir)).toHaveLength(1);
    });
    test(`${name}: the manifest`, () => {
      const home = scratch();
      const dir = join(home, "m");
      produce(home, { CATALYST_PATHS_FILE: manifest(home, dir) });
      expect(lines(dir)).toHaveLength(1);
    });
    test(`${name}: the default, and never ~/catalyst/events`, () => {
      const home = scratch();
      produce(home, {});
      expect(lines(join(home, ".local/state/catalyst/events"))).toHaveLength(1);
      expect(existsSync(join(home, "catalyst"))).toBe(false);
    });
  }
});

describe("briefing-followup writeback.sh", () => {
  test("a skipped writeback never resolves the events dir, so a broken manifest cannot fail it", () => {
    const home = scratch();
    writeFileSync(join(home, "b.md"), "---\ndate: 2026-09-27\n---\n");
    const r = bash(home, `bash '${join(repoRoot, "vendor-src/scripts/briefing-followup/writeback.sh")}' --briefing '${home}/b.md' --resolutions '${home}/none.json' --date 2026-09-27`, {
      CATALYST_PATHS_FILE: join(home, "missing-paths.json"),
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim()).status).toBe("skipped");
  });
});
