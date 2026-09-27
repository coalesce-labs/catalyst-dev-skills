// prune-worktrees.test.mjs — the prune skill resolves its roots fail-closed and removes only what
// it can prove is finished (CTC-3644).
//
// Run: bun test tests/prune-worktrees.test.mjs
//
// Each case builds a real farm in a temp dir: an owner repo, worktrees under <farm>/repo/<name>,
// a fake `gh` on PATH that prints a fixed PR list, and a fake Linear replica. HOME, XDG_* and every
// CATALYST_* variable are replaced, so the host's own farm and paths file are never read.

import { describe, test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../skills/prune-worktrees/scripts/prune-worktrees.mjs", import.meta.url));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "prune-worktrees-")));
const spawned = [];
afterAll(() => {
  for (const p of spawned) p.kill();
  rmSync(scratch, { recursive: true, force: true });
});

// Each case builds a git farm and runs the script as a subprocess: seconds, not milliseconds.
setDefaultTimeout(120_000);

const DAY = 86_400_000;
let farmCount = 0;

// A clean environment: only what the script needs from the host, nothing CATALYST_* from it.
function baseEnv(T) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CATALYST_|XDG_|GIT_)/.test(k)) env[k] = v;
  return {
    ...env,
    PATH: `${T}/bin:${process.env.PATH}`,
    HOME: `${T}/home`,
    XDG_CONFIG_HOME: `${T}/config`,
    XDG_STATE_HOME: `${T}/state`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t.t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t.t",
  };
}

function ageTree(dir, ms) {
  const when = new Date(Date.now() - ms);
  const walk = (p) => {
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) return;
    if (st.isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
    utimesSync(p, when, when);
  };
  walk(dir);
}

// buildFarm() → the fixture. Every tree is aged 5 days, except where a case says otherwise.
function buildFarm() {
  const T = join(scratch, `farm-${++farmCount}`);
  const R = `${T}/owner`;
  const W = `${T}/wt/repo`;
  for (const d of ["bin", "home", "config", "state", "wt/repo"]) mkdirSync(join(T, d), { recursive: true });
  const env = baseEnv(T);
  const g = (...args) => execFileSync("git", args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q", "-b", "main", R);
  g("-C", R, "commit", "-q", "--allow-empty", "-m", "init");
  writeFileSync(`${R}/.envrc`, "export A=1\n");
  g("-C", R, "add", ".envrc");
  g("-C", R, "commit", "-q", "-m", "envrc");
  g("-C", R, "update-ref", "refs/remotes/origin/main", "main");
  const mk = (name, commit) => {
    g("-C", R, "worktree", "add", "-q", "-b", name, `${W}/${name}`, "main");
    if (commit) {
      writeFileSync(`${W}/${name}/${name}.txt`, "work\n");
      g("-C", `${W}/${name}`, "add", ".");
      g("-C", `${W}/${name}`, "commit", "-q", "-m", `work on ${name}`);
    }
  };
  // Merged PR, and only agent residue left behind: a tracked .envrc edit, caches, a config backup.
  mk("merged-residue", true);
  writeFileSync(`${W}/merged-residue/.envrc`, "export A=1\nexport B=2\n");
  mkdirSync(`${W}/merged-residue/__pycache__`);
  writeFileSync(`${W}/merged-residue/__pycache__/m.pyc`, "x");
  mkdirSync(`${W}/merged-residue/.catalyst`);
  writeFileSync(`${W}/merged-residue/.catalyst/config.json.bak-1`, "{}");
  // Merged PR, but an untracked source file: real work.
  mk("merged-realwork", true);
  writeFileSync(`${W}/merged-realwork/new.ts`, "export const x = 1;\n");
  // Merged PR, touched an hour ago.
  mk("merged-recent", true);
  // Merged PR, and a process is cwd'd inside it.
  mk("merged-live", true);
  // Merged through a Mergify stack: the PR head is the stack rename.
  mk("stacked", true);
  // No PR; the ticket is Done in Linear.
  mk("CTC-9001-done", true);
  // No PR; the ticket is In Progress.
  mk("CTC-9002-open", true);

  writeFileSync(
    `${T}/prs.json`,
    JSON.stringify([
      { number: 1, title: "one", headRefName: "merged-residue", state: "MERGED" },
      { number: 2, title: "two", headRefName: "merged-realwork", state: "MERGED" },
      { number: 3, title: "three", headRefName: "merged-recent", state: "MERGED" },
      { number: 4, title: "four", headRefName: "merged-live", state: "MERGED" },
      { number: 5, title: "five", headRefName: "stack/t/stacked/I0123abcd", state: "MERGED" },
    ])
  );
  writeFileSync(`${T}/bin/gh`, `#!/bin/sh\ncat "${T}/prs.json"\n`);
  chmodSync(`${T}/bin/gh`, 0o755);

  const db = new Database(`${T}/replica.db`);
  db.run("CREATE TABLE workflow_states (id TEXT, type TEXT)");
  db.run("CREATE TABLE issues (identifier TEXT, state TEXT, state_id TEXT, state_type TEXT, archived_at TEXT)");
  db.run("INSERT INTO workflow_states VALUES ('s1', 'completed'), ('s2', 'started')");
  db.run("INSERT INTO issues VALUES ('CTC-9001', 'Done', 's1', '', NULL), ('CTC-9002', 'In Progress', 's2', 'started', NULL)");
  db.close();

  ageTree(`${T}/wt`, 5 * DAY);
  ageTree(`${R}/.git/worktrees`, 5 * DAY);
  const recentHead = `${R}/.git/worktrees/merged-recent/logs/HEAD`;
  utimesSync(recentHead, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
  return { T, R, W, env: { ...env, CATALYST_WORKTREES_DIR: `${T}/wt`, CATALYST_REPLICA_DB: `${T}/replica.db` }, g };
}

function run(fx, args, envOverride = {}) {
  const env = { ...fx.env, ...envOverride };
  for (const [k, v] of Object.entries(envOverride)) if (v === undefined) delete env[k];
  const r = Bun.spawnSync(["bun", SCRIPT, ...args], { cwd: fx.T, env, stdout: "pipe", stderr: "pipe" });
  const stdout = r.stdout.toString();
  let json = null;
  try {
    json = JSON.parse(stdout);
  } catch { /* not a --json run, or a refusal */ }
  return { code: r.exitCode, stdout, stderr: r.stderr.toString(), json };
}

const rows = (plan) => plan.repos.flatMap((r) => [...r.prunable, ...(r.protected ?? [])]);
const rowFor = (plan, name) => rows(plan).find((r) => r.path.endsWith(`/repo/${name}`));
const pathsJson = (T, worktrees, extra = {}) => ({
  version: 1,
  paths: {
    repoRoot: `${T}/repos`, worktrees, logs: `${T}/state/catalyst/logs`, events: `${T}/state/catalyst/events`,
    config: `${T}/config/catalyst`, cache: `${T}/cache`, state: `${T}/state/catalyst`, skills: `${T}/skills`, ...extra,
  },
  provenance: {},
});

describe("roots resolve from the installer, then env, else the script refuses", () => {
  test("a paths.json present wins over env", () => {
    const fx = buildFarm();
    const other = `${fx.T}/other-farm`;
    mkdirSync(other);
    mkdirSync(`${fx.T}/config/catalyst`, { recursive: true });
    writeFileSync(`${fx.T}/config/catalyst/paths.json`, JSON.stringify(pathsJson(fx.T, `${fx.T}/wt`, { replicaDb: `${fx.T}/replica.db` })));
    const r = run(fx, ["scan", "--json", "--no-sizes"], { CATALYST_WORKTREES_DIR: other, CATALYST_REPLICA_DB: undefined });
    expect(r.code).toBe(0);
    expect(r.json.root).toBe(`${fx.T}/wt`);
    expect(r.json.roots.source).toContain("paths.json");
    expect(r.json.roots.archive).toBe(`${fx.T}/wt-cleanup-archive`);
    expect(r.json.linearSource).toBe(`replica ${fx.T}/replica.db`);
  });

  test("env alone declares the root, and the legacy CATALYST_WORK_TREES still works", () => {
    const fx = buildFarm();
    const a = run(fx, ["scan", "--json", "--no-sizes"]);
    expect(a.code).toBe(0);
    expect(a.json.root).toBe(`${fx.T}/wt`);
    expect(a.json.roots.source).toBe("env CATALYST_WORKTREES_DIR");
    const b = run(fx, ["scan", "--json", "--no-sizes"], { CATALYST_WORKTREES_DIR: undefined, CATALYST_WORK_TREES: `${fx.T}/wt` });
    expect(b.json.roots.source).toBe("env CATALYST_WORK_TREES");
  });

  test("neither refuses non-zero and touches nothing", () => {
    const fx = buildFarm();
    const before = readdirSync(fx.W).sort();
    const branches = fx.g("-C", fx.R, "branch", "--format=%(refname:short)");
    const r = run(fx, ["apply", "--json", "--include-shipped", "--include-stale"], { CATALYST_WORKTREES_DIR: undefined });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("refusing to run, nothing was touched");
    expect(readdirSync(fx.W).sort()).toEqual(before);
    expect(fx.g("-C", fx.R, "branch", "--format=%(refname:short)")).toBe(branches);
    expect(readdirSync(`${fx.T}/state`)).toEqual([]);
    expect(existsSync(`${fx.T}/wt-cleanup-archive`)).toBe(false);
  });

  test("a broken paths.json refuses rather than falling back to env", () => {
    const fx = buildFarm();
    mkdirSync(`${fx.T}/config/catalyst`, { recursive: true });
    writeFileSync(`${fx.T}/config/catalyst/paths.json`, "{ not json");
    const r = run(fx, ["scan", "--json"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("machine paths file unusable");
  });
});

describe("a farm run removes only what it can prove is finished", () => {
  const fx = buildFarm();
  const live = Bun.spawn(["sleep", "120"], { cwd: `${fx.W}/merged-live` });
  spawned.push(live);
  const scan = run(fx, ["scan", "--json", "--no-sizes", "--include-shipped"]);
  const apply = run(fx, ["apply", "--json", "--include-shipped", "--actor", "test"]);
  const result = (name) => apply.json.repos[0].prunable.find((r) => r.path.endsWith(`/repo/${name}`));
  const archiveOf = (name) => join(fx.T, "wt-cleanup-archive", new Date().toISOString().slice(0, 10), `owner__${name}`);
  const branchExists = (b) => fx.g("-C", fx.R, "branch", "--list", b).trim() !== "";

  test("scan classifies every tree", () => {
    expect(scan.code).toBe(0);
    expect(scan.json.liveScan.ok).toBe(true);
    expect(rowFor(scan.json, "merged-residue").classification).toBe("MERGED");
    expect(rowFor(scan.json, "stacked").classification).toBe("MERGED");
    expect(rowFor(scan.json, "stacked").reason).toContain("Mergify stack rename");
    expect(rowFor(scan.json, "CTC-9001-done").classification).toBe("TICKET_DONE");
    expect(rowFor(scan.json, "CTC-9002-open").classification).toBe("ACTIVE");
    expect(rowFor(scan.json, "CTC-9002-open").reason).toContain("In Progress");
    expect(rowFor(scan.json, "merged-live").classification).toBe("LIVE");
  });

  test("a residue-only merged tree is removed, with a patch, a tar and a verified bundle", () => {
    expect(result("merged-residue").action).toBe("removed");
    expect(existsSync(`${fx.W}/merged-residue`)).toBe(false);
    const dir = archiveOf("merged-residue");
    expect(readFileSync(`${dir}/changes.patch`, "utf8")).toContain("+export B=2");
    const tarList = execFileSync("tar", ["-tzf", `${dir}/untracked.tar.gz`], { encoding: "utf8" });
    expect(tarList).toContain("__pycache__/m.pyc");
    expect(tarList).toContain(".catalyst/config.json.bak-1");
    fx.g("-C", fx.R, "bundle", "verify", `${dir}/unpushed.bundle`);
    expect(JSON.parse(readFileSync(`${dir}/meta.json`, "utf8")).classification).toBe("MERGED");
    expect(branchExists("merged-residue")).toBe(false);
  });

  test("a tree with real work is kept-dirty", () => {
    expect(result("merged-realwork").action).toBe("kept-dirty");
    expect(result("merged-realwork").error).toContain("new.ts");
    expect(existsSync(`${fx.W}/merged-realwork/new.ts`)).toBe(true);
    expect(branchExists("merged-realwork")).toBe(true);
  });

  test("a recently touched tree is kept-recent", () => {
    expect(result("merged-recent").action).toBe("kept-recent");
    expect(existsSync(`${fx.W}/merged-recent`)).toBe(true);
  });

  test("a Linear Done tree is removed and its branch bundled", () => {
    expect(result("CTC-9001-done").action).toBe("removed");
    expect(result("CTC-9001-done").note).toContain("bundling");
    fx.g("-C", fx.R, "bundle", "verify", `${archiveOf("CTC-9001-done")}/unpushed.bundle`);
    expect(branchExists("CTC-9001-done")).toBe(false);
  });

  test("an In Progress tree is protected", () => {
    expect(existsSync(`${fx.W}/CTC-9002-open`)).toBe(true);
    expect(branchExists("CTC-9002-open")).toBe(true);
  });

  test("a tree with a live process cwd'd inside is kept LIVE", () => {
    expect(rowFor(apply.json, "merged-live").classification).toBe("LIVE");
    expect(rowFor(apply.json, "merged-live").reason).toContain(`pid ${live.pid}`);
    expect(existsSync(`${fx.W}/merged-live`)).toBe(true);
    expect(branchExists("merged-live")).toBe(true);
  });

  test("the run logs itself", () => {
    const log = readFileSync(`${fx.T}/state/catalyst/logs/worktree-prune/runs.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.map((l) => l.mode)).toEqual(["scan", "apply-started", "apply"]);
    expect(log[2].totals.removed).toBe(3);
  });
});

describe("the process scan fails closed", () => {
  test("a failed scan marks every tree LIVE, removes nothing and exits 3", () => {
    const fx = buildFarm();
    writeFileSync(`${fx.T}/bin/lsof-broken`, "#!/bin/sh\nexit 1\n");
    chmodSync(`${fx.T}/bin/lsof-broken`, 0o755);
    const before = readdirSync(fx.W).sort();
    const r = run(fx, ["apply", "--json", "--include-shipped"], { CATALYST_PRUNE_LSOF: `${fx.T}/bin/lsof-broken` });
    expect(r.code).toBe(3);
    expect(r.json.liveScan.ok).toBe(false);
    expect(r.stderr).toContain("every tree is treated as LIVE");
    expect(rows(r.json).every((x) => x.classification === "LIVE")).toBe(true);
    expect(r.json.totals.removed).toBe(0);
    expect(readdirSync(fx.W).sort()).toEqual(before);
  });
});

describe("Linear falls back to linearis when there is no replica", () => {
  test("linearis reads only the tickets that reach the Linear check", () => {
    const fx = buildFarm();
    writeFileSync(
      `${fx.T}/bin/linearis`,
      `#!/bin/sh\necho "$3" >> "${fx.T}/linearis.calls"\ncase "$3" in CTC-9001) echo '{"identifier":"CTC-9001","state":{"name":"Done"}}' ;; *) echo '{"state":{"name":"In Progress"}}' ;; esac\n`
    );
    chmodSync(`${fx.T}/bin/linearis`, 0o755);
    const r = run(fx, ["scan", "--json", "--no-sizes", "--include-shipped"], { CATALYST_REPLICA_DB: undefined });
    expect(r.json.linearSource).toBe("linearis");
    expect(rowFor(r.json, "CTC-9001-done").classification).toBe("TICKET_DONE");
    expect(rowFor(r.json, "CTC-9002-open").classification).toBe("ACTIVE");
    expect(readFileSync(`${fx.T}/linearis.calls`, "utf8").trim().split("\n").sort()).toEqual(["CTC-9001", "CTC-9002"]);
  });

  test("inside a phase container linearis is skipped, with a warning", () => {
    const fx = buildFarm();
    writeFileSync(`${fx.T}/bin/linearis`, `#!/bin/sh\necho called >> "${fx.T}/linearis.calls"\n`);
    chmodSync(`${fx.T}/bin/linearis`, 0o755);
    const r = run(fx, ["scan", "--json", "--no-sizes", "--include-shipped"], { CATALYST_REPLICA_DB: undefined, CATALYST_PHASE: "implement" });
    expect(r.json.linearSource).toBe("none");
    expect(r.stderr).toContain("no ticket-Done trigger this run");
    expect(rowFor(r.json, "CTC-9001-done").classification).toBe("ACTIVE");
    expect(existsSync(`${fx.T}/linearis.calls`)).toBe(false);
  });
});
