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
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  db.run("CREATE TABLE workflow_states (id TEXT, name TEXT, type TEXT)");
  db.run("CREATE TABLE issues (identifier TEXT, state TEXT, state_id TEXT, state_type TEXT, archived_at TEXT)");
  db.run("INSERT INTO workflow_states VALUES ('s1', 'Done', 'completed'), ('s2', 'In Progress', 'started'), ('s3', 'Todo', 'unstarted')");
  db.run("INSERT INTO issues VALUES ('CTC-9001', 'Done', 's1', '', NULL), ('CTC-9002', 'In Progress', 's2', 'started', NULL)");
  db.close();

  ageTree(`${T}/wt`, 5 * DAY);
  ageTree(`${R}/.git/worktrees`, 5 * DAY);
  const recentHead = `${R}/.git/worktrees/merged-recent/logs/HEAD`;
  utimesSync(recentHead, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
  return { T, R, W, env: { ...env, CATALYST_WORKTREES_DIR: `${T}/wt`, CATALYST_REPLICA_DB: `${T}/replica.db` }, g, mk, prs: `${T}/prs.json` };
}

// addMergedTree(fx, name, number) → a new tree on a branch with one commit and a merged PR, aged 5 days
// after the caller has shaped it (call age() when done).
function addMergedTree(fx, name, number) {
  fx.mk(name, true);
  const prs = JSON.parse(readFileSync(fx.prs, "utf8"));
  prs.push({ number, title: name, headRefName: name, state: "MERGED" });
  writeFileSync(fx.prs, JSON.stringify(prs));
  return `${fx.W}/${name}`;
}
const age = (fx) => {
  ageTree(`${fx.T}/wt`, 5 * DAY);
  ageTree(`${fx.R}/.git/worktrees`, 5 * DAY);
};

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

describe("roots resolve from env, then the installer's paths.json, else the script refuses", () => {
  test("paths.json supplies every role env leaves unset", () => {
    const fx = buildFarm();
    mkdirSync(`${fx.T}/config/catalyst`, { recursive: true });
    writeFileSync(`${fx.T}/config/catalyst/paths.json`, JSON.stringify(pathsJson(fx.T, `${fx.T}/wt`, { replicaDb: `${fx.T}/replica.db` })));
    const r = run(fx, ["scan", "--json", "--no-sizes"], { CATALYST_WORKTREES_DIR: undefined, CATALYST_REPLICA_DB: undefined });
    expect(r.code).toBe(0);
    expect(r.json.root).toBe(`${fx.T}/wt`);
    expect(r.json.roots.source).toContain("paths.json");
    expect(r.json.roots.archive).toBe(`${fx.T}/wt-cleanup-archive`);
    expect(r.json.linearSource).toBe(`replica ${fx.T}/replica.db`);
  });

  test("the legacy CATALYST_WORK_TREES alias ranks after paths.json, which create-worktree follows", () => {
    const fx = buildFarm();
    const other = `${fx.T}/other-farm`;
    mkdirSync(other);
    mkdirSync(`${fx.T}/config/catalyst`, { recursive: true });
    writeFileSync(`${fx.T}/config/catalyst/paths.json`, JSON.stringify(pathsJson(fx.T, `${fx.T}/wt`, { replicaDb: `${fx.T}/replica.db` })));
    const r = run(fx, ["scan", "--json", "--no-sizes"], { CATALYST_WORKTREES_DIR: undefined, CATALYST_WORK_TREES: other, CATALYST_REPLICA_DB: undefined });
    expect(r.code).toBe(0);
    expect(r.json.root).toBe(`${fx.T}/wt`);
    expect(r.json.roots.source).toContain("paths.json");
  });

  // CTC-3791: the paths contract puts env first, and create-worktree follows it, so the prune
  // must scan the farm env names or trees created there are never pruned.
  test("env wins over paths.json, as it does for create-worktree", () => {
    const fx = buildFarm();
    const other = `${fx.T}/other-farm`;
    mkdirSync(other);
    mkdirSync(`${fx.T}/config/catalyst`, { recursive: true });
    writeFileSync(`${fx.T}/config/catalyst/paths.json`, JSON.stringify(pathsJson(fx.T, other, { replicaDb: `${fx.T}/replica.db` })));
    const r = run(fx, ["scan", "--json", "--no-sizes"], { CATALYST_REPLICA_DB: undefined });
    expect(r.code).toBe(0);
    expect(r.json.root).toBe(`${fx.T}/wt`);
    expect(r.json.roots.source).toBe("env CATALYST_WORKTREES_DIR");
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

// CTC-3791: two owners' clones can share a repo name and a ticket, so an archive name can already
// be taken that day. The earlier archive is never overwritten.
describe("an archive name already taken that day is never reused", () => {
  test("the tree's archive goes to <repo>__<tree>-2 and the earlier one is untouched", () => {
    const fx = buildFarm();
    const day = join(fx.T, "wt-cleanup-archive", new Date().toISOString().slice(0, 10));
    const taken = join(day, "owner__merged-residue");
    mkdirSync(taken, { recursive: true });
    writeFileSync(join(taken, "meta.json"), "earlier tree");
    const r = run(fx, ["apply", "--json"]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(taken, "meta.json"), "utf8")).toBe("earlier tree");
    expect(JSON.parse(readFileSync(join(`${taken}-2`, "meta.json"), "utf8")).path).toContain("merged-residue");
  });
});

// CTC-3790: a housekeeping apply also migrates and prunes the event log, unless the installer runs
// that as its own step.
describe("a housekeeping apply runs the event-log step", () => {
  const seed = (fx) => {
    const dir = join(fx.T, "state", "catalyst", "events");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2020-01.jsonl"), "old\n");
    return join(dir, "2020-01.jsonl");
  };
  test("--actor housekeeping prunes months past the retention", () => {
    const fx = buildFarm();
    const old = seed(fx);
    const r = run(fx, ["apply", "--json", "--actor", "housekeeping"]);
    expect(r.json.eventsHousekeeping.status).toBe("ok");
    expect(existsSync(old)).toBe(false);
  });
  test("an installer that runs the step itself (CATALYST_HK_EVENTS_STEP=1) is not doubled", () => {
    const fx = buildFarm();
    const old = seed(fx);
    const r = run(fx, ["apply", "--json", "--actor", "housekeeping"], { CATALYST_HK_EVENTS_STEP: "1" });
    expect(r.json.eventsHousekeeping).toBeUndefined();
    expect(existsSync(old)).toBe(true);
  });
  test("an interactive apply never touches the event log", () => {
    const fx = buildFarm();
    const old = seed(fx);
    run(fx, ["apply", "--json"]);
    expect(existsSync(old)).toBe(true);
  });
});

// CTC-3906: create-worktree nests trees by org, <root>/<org>/<repo>/<leaf>; the flat layout still counts.
describe("the by-org layout is discovered beside the flat one", () => {
  test("a tree under <org>/<repo> is scanned and pruned, and a compatibility symlink is not counted twice", () => {
    const fx = buildFarm();
    const root = dirname(fx.W);
    const moved = join(root, "acme", "repo", "merged-residue");
    mkdirSync(dirname(moved), { recursive: true });
    fx.g("-C", fx.R, "worktree", "move", join(fx.W, "merged-residue"), moved);
    symlinkSync(join(root, "acme", "repo"), join(root, "compat-link"));
    const scan = run(fx, ["scan", "--json", "--no-sizes"]);
    const hits = rows(scan.json).filter((r) => r.path.endsWith("/merged-residue"));
    expect(hits.map((r) => r.path)).toEqual([moved]);
    expect(hits[0].classification).toBe("MERGED");
    run(fx, ["apply", "--json"]);
    expect(existsSync(moved)).toBe(false);
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

describe("Linear state comes from the workflow state, never a stale issue field (CTC-3654)", () => {
  // CTC-3632 was reopened to Todo while issues.state_type still said `completed` (509 of 7,660
  // replica rows disagreed with their workflow state on 2026-09-27).
  test("a reopened ticket with a stale state_type of completed is kept", () => {
    const fx = buildFarm();
    fx.mk("CTC-9003-reopened", true);
    fx.mk("CTC-9004-orphan", true);
    age(fx);
    const db = new Database(`${fx.T}/replica.db`);
    db.run("INSERT INTO issues VALUES ('CTC-9003', 'Done', 's3', 'completed', NULL), ('CTC-9004', 'Done', 'gone', 'completed', NULL)");
    db.close();
    const scan = run(fx, ["scan", "--json", "--no-sizes", "--include-shipped"]);
    expect(rowFor(scan.json, "CTC-9003-reopened").classification).toBe("ACTIVE");
    expect(rowFor(scan.json, "CTC-9003-reopened").reason).toContain("ticket Todo");
    // No joined workflow state means no Linear evidence at all.
    expect(rowFor(scan.json, "CTC-9004-orphan").classification).toBe("ACTIVE");
    expect(rowFor(scan.json, "CTC-9001-done").classification).toBe("TICKET_DONE");
    const apply = run(fx, ["apply", "--json", "--include-shipped"]);
    expect(apply.code).toBe(0);
    expect(existsSync(`${fx.W}/CTC-9003-reopened`)).toBe(true);
    expect(existsSync(`${fx.W}/CTC-9004-orphan`)).toBe(true);
  });

  test("the linearis fallback reads the live state name, not a stale type field", () => {
    const fx = buildFarm();
    writeFileSync(
      `${fx.T}/bin/linearis`,
      `#!/bin/sh\necho '{"identifier":"'"$3"'","stateType":"completed","state_type":"completed","status":"Done","state":{"id":"s3","name":"Todo"}}'\n`
    );
    chmodSync(`${fx.T}/bin/linearis`, 0o755);
    const r = run(fx, ["scan", "--json", "--no-sizes", "--include-shipped"], { CATALYST_REPLICA_DB: undefined });
    expect(r.json.linearSource).toBe("linearis");
    expect(rowFor(r.json, "CTC-9001-done").classification).toBe("ACTIVE");
    expect(rowFor(r.json, "CTC-9001-done").reason).toContain("ticket Todo");
  });
});

describe("five more agent files are residue (CTC-3654)", () => {
  const fx = buildFarm();
  // catalyst's ea30621b6 committed the scheduled-tasks lock, so worktrees show it deleted (` D`).
  mkdirSync(`${fx.R}/.claude`, { recursive: true });
  writeFileSync(`${fx.R}/.claude/scheduled_tasks.lock`, "lock\n");
  fx.g("-C", fx.R, "add", ".claude/scheduled_tasks.lock");
  fx.g("-C", fx.R, "commit", "-q", "-m", "commit the lock by mistake");
  fx.g("-C", fx.R, "update-ref", "refs/remotes/origin/main", "main");
  const untracked = {
    "res-hosts": ".catalyst/hosts.json",
    "res-skill-refs": ".claude/rules/skill-references.md",
    "res-findings": ".catalyst/findings/current.jsonl",
    "res-codex": ".codex/agents/reviewer.toml",
    "res-other-rule": ".claude/rules/other.md",
  };
  let n = 100;
  for (const [name, file] of Object.entries(untracked)) {
    const dir = addMergedTree(fx, name, ++n);
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), "agent residue\n");
  }
  rmSync(`${addMergedTree(fx, "res-lock-deleted", ++n)}/.claude/scheduled_tasks.lock`);
  age(fx);
  const apply = run(fx, ["apply", "--json", "--include-shipped"]);
  const result = (name) => apply.json.repos[0].prunable.find((r) => r.path.endsWith(`/repo/${name}`));
  const archiveOf = (name) => join(fx.T, "wt-cleanup-archive", new Date().toISOString().slice(0, 10), `owner__${name}`);

  for (const [name, file] of Object.entries(untracked)) {
    if (name === "res-other-rule") continue;
    test(`${file} alone lets the tree go, archived`, () => {
      expect(result(name).action).toBe("removed");
      expect(existsSync(`${fx.W}/${name}`)).toBe(false);
      expect(execFileSync("tar", ["-tzf", `${archiveOf(name)}/untracked.tar.gz`], { encoding: "utf8" })).toContain(file);
      expect(JSON.parse(readFileSync(`${archiveOf(name)}/meta.json`, "utf8")).archived).toEqual([file]);
    });
  }

  test("any other .claude/rules file is real work: kept-dirty", () => {
    expect(result("res-other-rule").action).toBe("kept-dirty");
    expect(result("res-other-rule").error).toContain(".claude/rules/other.md");
    expect(existsSync(`${fx.W}/res-other-rule/.claude/rules/other.md`)).toBe(true);
  });

  test("a deleted tracked scheduled_tasks.lock is recorded in the patch, and the tree goes", () => {
    expect(result("res-lock-deleted").action).toBe("removed");
    expect(existsSync(`${fx.W}/res-lock-deleted`)).toBe(false);
    const patch = readFileSync(`${archiveOf("res-lock-deleted")}/changes.patch`, "utf8");
    expect(patch).toContain("deleted file mode");
    expect(patch).toContain("-lock");
    expect(patch).toContain(".claude/scheduled_tasks.lock");
  });
});

describe("release, deploy and opted-out trees are never removed (CTC-3654)", () => {
  // 2026-09-27: 12 idle, clean deploy-3072373-R* trees with HEAD in main were removed, and infra's
  // R7 build failed because build-R6.sh reads a prior release tree's gitignored build output.
  const fx = buildFarm();
  let n = 200;
  for (const name of ["deploy-3072373-R7-abc", "release-automation", "keep-file", "keep-listed", "keep-bare"]) addMergedTree(fx, name, ++n);
  // A protected branch basename on an ordinary directory name.
  fx.g("-C", fx.R, "worktree", "add", "-q", "-b", "infra/release-9", `${fx.W}/plain-dir`, "main");
  writeFileSync(`${fx.W}/plain-dir/x.txt`, "x\n");
  fx.g("-C", `${fx.W}/plain-dir`, "add", ".");
  fx.g("-C", `${fx.W}/plain-dir`, "commit", "-q", "-m", "x");
  const prs = JSON.parse(readFileSync(fx.prs, "utf8"));
  prs.push({ number: 299, title: "x", headRefName: "infra/release-9", state: "MERGED" });
  writeFileSync(fx.prs, JSON.stringify(prs));
  mkdirSync(`${fx.W}/keep-file/.catalyst`);
  writeFileSync(`${fx.W}/keep-file/.catalyst/keep-worktree`, "");
  writeFileSync(`${fx.T}/wt/.keep-worktrees`, "# trees infra still reads\nrepo/keep-listed\nkeep-bare  # by bare name\n");
  age(fx);
  const kept = ["deploy-3072373-R7-abc", "release-automation", "keep-file", "keep-listed", "keep-bare", "plain-dir"];
  const scan = run(fx, ["scan", "--json", "--no-sizes", "--include-shipped"]);
  const apply = run(fx, ["apply", "--json", "--include-shipped"]);

  test("scan reports each one as PROTECTED, with the reason", () => {
    expect(rowFor(scan.json, "deploy-3072373-R7-abc").reason).toBe("protected name deploy-3072373-R7-abc");
    expect(rowFor(scan.json, "release-automation").reason).toBe("protected name release-automation");
    expect(rowFor(scan.json, "keep-file").reason).toBe("keep file .catalyst/keep-worktree");
    expect(rowFor(scan.json, "keep-listed").reason).toContain(".keep-worktrees");
    expect(rowFor(scan.json, "keep-bare").reason).toContain(".keep-worktrees");
    expect(rowFor(scan.json, "plain-dir").reason).toBe("protected branch infra/release-9");
    for (const name of kept) expect(rowFor(scan.json, name).classification).toBe("PROTECTED");
    expect(scan.json.totals.keptProtected).toBe(kept.length);
  });

  test("apply removes none of them, and still removes the residue-only control", () => {
    for (const name of kept) expect(existsSync(`${fx.W}/${name}`)).toBe(true);
    expect(apply.json.totals.keptProtected).toBe(kept.length);
    expect(existsSync(`${fx.W}/merged-residue`)).toBe(false);
  });

  test("remove --path refuses a protected tree and exits non-zero", () => {
    const r = run(fx, ["remove", "--json", "--path", `${fx.W}/deploy-3072373-R7-abc`, "--why", "test"]);
    expect(r.code).toBe(1);
    expect(r.json.results[0].action).toBe("kept-protected");
    expect(existsSync(`${fx.W}/deploy-3072373-R7-abc`)).toBe(true);
  });
});

// CTC-8921: exercise the executable, including its shared explicit-removal guard.
function tool(fx, name, body) {
  writeFileSync(`${fx.T}/bin/${name}`, `#!/bin/sh\n${body}\n`);
  chmodSync(`${fx.T}/bin/${name}`, 0o755);
}
function launchJob(fx, data) {
  const dir = `${fx.T}/home/Library/LaunchAgents`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/job.plist`, '<?xml version="1.0"?><plist><dict/></plist>');
  writeFileSync(`${fx.T}/decoded.json`, JSON.stringify(data));
  tool(fx, 'plutil', `cat '${fx.T}/decoded.json'`);
}

describe('scheduled and process dependency guards', () => {
  test('LaunchAgent alias keeps a HEAD_IN_MAIN tree and branch in apply and explicit remove', () => {
    const fx = buildFarm(); fx.mk('hourly', false); fx.mk('control', false); age(fx);
    mkdirSync(`${fx.T}/wt/coalesce-labs/repo`, { recursive: true });
    const target = `${fx.T}/wt/coalesce-labs/repo/hourly`;
    fx.g('-C', fx.R, 'worktree', 'move', `${fx.W}/hourly`, target);
    age(fx);
    symlinkSync(`${fx.T}/wt/coalesce-labs/repo`, `${fx.T}/alias`);
    launchJob(fx, { Label: 'dev.catalystcloud.ci-fleet-load', ProgramArguments: ['/bin/bash', `${fx.T}/alias/hourly/missing.sh`] });
    const applied = run(fx, ['apply', '--include-shipped', '--json']);
    expect(applied.code).toBe(0);
    expect(rowFor(applied.json, 'hourly')).toMatchObject({ classification: 'PROTECTED', reason: 'LaunchAgent dev.catalystcloud.ci-fleet-load (ProgramArguments)' });
    expect(existsSync(`${fx.W}/control`)).toBe(false);
    expect(existsSync(target)).toBe(true);
    expect(fx.g('-C', fx.R, 'branch', '--list', 'hourly').trim()).not.toBe('');
    const removed = run(fx, ['remove', '--path', target, '--why', 'reclaim disk', '--json']);
    expect(removed.code).toBe(1);
    expect(removed.json.results[0]).toMatchObject({ action: 'kept-protected', error: 'LaunchAgent dev.catalystcloud.ci-fleet-load (ProgramArguments); scheduled job still references this tree' });
    const plain = run(fx, ['remove', '--path', target, '--why', 'reclaim disk']);
    expect(plain.stdout).toBe('');
    expect(plain.stderr).toContain('scheduled job still references this tree');
    expect(readFileSync(`${fx.T}/state/catalyst/logs/worktree-prune/runs.jsonl`, 'utf8')).toContain('LaunchAgent dev.catalystcloud.ci-fleet-load (ProgramArguments)');
  });
  for (const field of ['Program', 'WorkingDirectory', 'StandardOutPath', 'StandardErrorPath']) {
    test(`LaunchAgent ${field} protects independently`, () => {
      const fx = buildFarm(); fx.mk('hourly', false); age(fx);
      symlinkSync(fx.W, `${fx.T}/alias`);
      launchJob(fx, { Label: 'dev.job', [field]: `${fx.T}/alias/hourly/missing` });
      const result = run(fx, ['scan', '--json', '--no-sizes']);
      expect(rowFor(result.json, 'hourly')).toMatchObject({ classification: 'PROTECTED', reason: `LaunchAgent dev.job (${field})` });
    });
  }
  test('current-user cron protects, comments and sibling paths do not protect controls', () => {
    const fx = buildFarm(); fx.mk('hourly', false); fx.mk('control', false); age(fx);
    tool(fx, 'crontab', `cat <<'CRON'\n# @hourly ${fx.W}/control/job\nHOME=${fx.W}\n@hourly ./hourly/job\n* * * * * ${fx.W}/control-sibling/job\nCRON`);
    const scanned = run(fx, ['scan', '--json']);
    expect(rowFor(scanned.json, 'hourly').reason).toContain('line 3: @hourly ./hourly/job');
    expect(run(fx, ['remove', '--path', `${fx.W}/hourly`, '--why', 'test', '--json']).json.results[0].action).toBe('kept-protected');
    expect(run(fx, ['remove', '--path', `${fx.W}/control`, '--why', 'test', '--json']).json.results[0].action).toBe('removed');
    expect(run(fx, ['apply', '--json']).code).toBe(0);
    expect(existsSync(`${fx.W}/hourly`)).toBe(true);
  });
  test('a cron entry running a quoted nested shell command keeps its HEAD_IN_MAIN tree', () => {
    const fx = buildFarm();
    writeFileSync(`${fx.R}/job.sh`, 'true\n');
    fx.g('-C', fx.R, 'add', 'job.sh'); fx.g('-C', fx.R, 'commit', '-qm', 'job');
    fx.g('-C', fx.R, 'update-ref', 'refs/remotes/origin/main', 'main');
    fx.mk('hourly', false); fx.mk('control', false); age(fx);
    const entry = `@hourly bash -lc 'exec ${fx.W}/hourly/job.sh'`;
    tool(fx, 'crontab', `cat <<'CRON'\n${entry}\nCRON`);
    const applied = run(fx, ['apply', '--include-shipped', '--json']);
    expect(applied.code).toBe(0);
    expect(rowFor(applied.json, 'hourly')).toMatchObject({ classification: 'PROTECTED', reason: expect.stringContaining(`line 1: ${entry}`) });
    expect(existsSync(`${fx.W}/hourly/job.sh`)).toBe(true);
    expect(existsSync(`${fx.W}/control`)).toBe(false);
  });
  test('real process with outside cwd and a spaced alias argument is LIVE', async () => {
    const fx = buildFarm();
    writeFileSync(`${fx.R}/job.sh`, 'sleep 120\n');
    fx.g('-C', fx.R, 'add', 'job.sh'); fx.g('-C', fx.R, 'commit', '-qm', 'job');
    fx.g('-C', fx.R, 'update-ref', 'refs/remotes/origin/main', 'main');
    fx.mk('hourly', false); age(fx);
    symlinkSync(fx.W, `${fx.T}/space alias`);
    const proc = Bun.spawn(['bash', `${fx.T}/space alias/hourly/job.sh`], { cwd: fx.T }); spawned.push(proc);
    try {
      const scanned = run(fx, ['scan', '--json']);
      expect(rowFor(scanned.json, 'hourly')).toMatchObject({ classification: 'LIVE', reason: `process references tree (pid ${proc.pid}; argument)` });
      expect(run(fx, ['apply', '--json']).code).toBe(0);
      expect(run(fx, ['remove', '--path', `${fx.W}/hourly`, '--why', 'test', '--json']).json.results[0].action).toBe('kept-live');
      expect(existsSync(`${fx.W}/hourly`)).toBe(true);
    } finally { proc.kill(); await proc.exited; }
  });
  test('unexpected scheduler failure refuses classification and explicit removal', () => {
    const fx = buildFarm(); fx.mk('hourly', false); age(fx);
    tool(fx, 'crontab', 'echo denied >&2; exit 2');
    const scanned = run(fx, ['apply', '--json']);
    expect(scanned.code).toBe(3);
    expect(rowFor(scanned.json, 'hourly').reason).toBe('scheduled reference scan failed; removal refused');
    const removed = run(fx, ['remove', '--path', `${fx.W}/hourly`, '--why', 'test', '--json']);
    expect(removed.code).toBe(1);
    expect(removed.json.results[0].error).toContain('denied');
    expect(existsSync(`${fx.W}/hourly`)).toBe(true);
  });
  for (const source of ['scheduler', 'process', 'failure']) {
    test(`fresh ${source} at PR-read boundary is detected before archive or deletion`, async () => {
      const fx = buildFarm(); fx.mk('hourly', false); age(fx);
      const target = `${fx.W}/hourly`;
      if (source === 'scheduler') {
        launchJob(fx, { Label: 'dev.late', Program: `${target}/job` });
        rmSync(`${fx.T}/home/Library/LaunchAgents/job.plist`);
        tool(fx, 'gh', `touch '${fx.T}/home/Library/LaunchAgents/job.plist'\ncat '${fx.T}/prs.json'`);
      } else if (source === 'failure') {
        tool(fx, 'crontab', `if test -f '${fx.T}/late'; then echo denied >&2; exit 2; fi\necho 'no crontab for user' >&2\nexit 1`);
        tool(fx, 'gh', `touch '${fx.T}/late'\ncat '${fx.T}/prs.json'`);
      } else {
        // Start a real process only when gh is called, after the initial process inventory.
        writeFileSync(`${fx.T}/launch.mjs`, `const p = Bun.spawn(['bash', '-c', 'while :; do sleep 1; done', '${target}/job'], {cwd: '${fx.T}', stdout:'ignore', stderr:'ignore'}); await Bun.write('${fx.T}/pid', String(p.pid)); p.unref();`);
        tool(fx, 'gh', `bun '${fx.T}/launch.mjs'\ncat '${fx.T}/prs.json'`);
      }
      try {
        const applied = run(fx, ['apply', '--json']);
        const row = rowFor(applied.json, 'hourly');
        expect(row.action).toBe(source === 'process' ? 'kept-live' : 'kept-protected');
        expect(applied.code).toBe(source === 'failure' ? 3 : 0);
        expect(existsSync(target)).toBe(true);
        expect(fx.g('-C', fx.R, 'branch', '--list', 'hourly').trim()).not.toBe('');
        expect(existsSync(`${fx.T}/wt-cleanup-archive/${new Date().toISOString().slice(0,10)}/owner__hourly`)).toBe(false);
      } finally {
        if (existsSync(`${fx.T}/pid`)) { try { process.kill(Number(readFileSync(`${fx.T}/pid`, 'utf8'))); } catch {} }
      }
    });
  }
});


test('a failed final process refresh keeps the tree and makes apply incomplete', () => {
  const fx = buildFarm(); fx.mk('hourly', false); age(fx);
  tool(fx, 'lsof', `if test -f '${fx.T}/seen'; then exit 2; fi\ntouch '${fx.T}/seen'\necho p$PPID\necho n${fx.T}`);
  const result = run(fx, ['apply', '--json'], { CATALYST_PRUNE_LSOF: `${fx.T}/bin/lsof` });
  expect(result.code).toBe(3);
  expect(rowFor(result.json, 'hourly').action).toBe('kept-live');
  expect(existsSync(`${fx.W}/hourly`)).toBe(true);
});

test('a skill-only installed copy scans without checkout-level runtime dependencies', () => {
  const fx = buildFarm();
  cpSync(dirname(dirname(SCRIPT)), `${fx.T}/installed`, { recursive: true });
  const result = Bun.spawnSync(['bun', `${fx.T}/installed/scripts/prune-worktrees.mjs`, 'scan', '--json', '--no-sizes'], { env: fx.env, cwd: fx.T });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString()).totals.leaves).toBe(7);
});
