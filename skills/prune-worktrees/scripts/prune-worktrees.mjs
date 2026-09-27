#!/usr/bin/env bun
// prune-worktrees.mjs — deterministic scanner/pruner for a Catalyst worktree farm.
//
//   scan                                   classify every leaf, report the
//                                          provably-safe prunable set (dry-run)
//   apply                                  remove that set (still per-tree
//                                          fail-closed)
//   candidates                             the PROTECTED set enriched with
//                                          staleness signals for human review
//   remove --path P [--path P] --why "…"   human-approved removal of specific
//                                          trees (dirty refuses)
//   history [--limit N]                    replay the JSONL run log
//   explain <ticket|branch|substring>      search history for one tree
//
// Roots, fail-closed (CTC-3644). A destructive tool must not guess where to
// work, so scan/apply/candidates/remove refuse, exit 2 and touch nothing unless
// the worktrees root is declared:
//   1. the installer's machine paths file ($CATALYST_PATHS_FILE, else
//      $XDG_CONFIG_HOME/catalyst/paths.json): roles `worktrees`, `repoRoot`,
//      `replicaDb`. It wins over env when present; a broken file refuses.
//   2. env: CATALYST_WORKTREES_DIR (legacy CATALYST_WORK_TREES), CATALYST_REPO_ROOT.
// The resolver's own defaults ($CATALYST_HOME/…) are never used here.
//
// Safety model:
//   * Removal needs positive evidence: a PR MERGED or CLOSED unmerged, HEAD
//     already in origin's default branch, or (with --include-shipped) the
//     ticket shipped or Done in Linear. STALE needs --include-stale.
//   * LIVE: any process whose cwd is inside a tree protects it. The scan runs
//     once per run and again right before each removal. If the scan fails,
//     every tree is treated as LIVE and nothing is removed.
//   * `git worktree remove --force` runs only when every change in the tree is
//     archived agent residue (TRIVIAL_DIRTY). Anything else keeps the tree.
//   * A branch `git branch -d` refuses is deleted only after its commits are
//     bundled and the bundle verifies. Never a remote delete.
//   * Full clones (a .git DIRECTORY) and paths outside the worktrees root are
//     never candidates.
//   * PROTECTED: a deploy/release name, .catalyst/keep-worktree, or an entry in
//     <worktrees>/.keep-worktrees. Checked first in classification and removal.
//
// Every scan/apply/remove run appends one JSONL line to
// $CATALYST_LOGS_DIR/worktree-prune/runs.jsonl. Human lines go to stderr;
// --json prints the full machine report on stdout.
//
// Other env:
//   CATALYST_LOGS_DIR             log root (default ${XDG_STATE_HOME:-~/.local/state}/catalyst/logs)
//   CATALYST_WT_ARCHIVE           archive root (default <dirname(worktrees)>/wt-cleanup-archive)
//   CATALYST_REPLICA_DB           Linear replica, when paths.json names none
//   CATALYST_WORKTREE_STALE_DAYS  no-evidence trees older than this are STALE (default 14)
//   CATALYST_PRUNE_RECENT_HOURS   recency guard (default 6)
//   CATALYST_PRUNE_LINEARIS_MAX   linearis reads per run when there is no replica (default 100)
//   CATALYST_PRUNE_LSOF           lsof binary; forces the lsof process scan (tests)

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { loadMachinePaths, machinePathsFile } from "./lib/paths/node.js";

const HOME = process.env.HOME || homedir();
const LOG_ROOT = resolve(
  process.env.CATALYST_LOGS_DIR ||
    join(process.env.XDG_STATE_HOME || join(HOME, ".local", "state"), "catalyst", "logs")
);
const RUN_LOG = join(LOG_ROOT, "worktree-prune", "runs.jsonl");

// CTC-3640 — what a removal saves first, and what it may discard. Agent residue
// (a direnv edit, config backups, caches) made 25-52 merged trees "kept-dirty"
// on every run; 24 of the 42 dirty trees in the 2026-09-27 audit held nothing
// else. Those files are archived, then the tree is removed. Anything outside
// this list still keeps the tree.
const TRIVIAL_DIRTY = [
  /(^|\/)\.envrc$/,
  /^\.catalyst\/config\.json\.bak-/,
  /(^|\/)__pycache__\//,
  /(^|\/)\.turbo\//,
  /(^|\/)coverage\//,
  /(^|\/)\.session-id$/,
  /(^|\/)\.workflow-context\.json$/,
  // CTC-3654, from a read-only survey of mini-2's kept-dirty trees. Exact paths: any other
  // .claude/rules file can be real work. scheduled_tasks.lock is tracked in catalyst by mistake
  // (ea30621b6), so it shows as a deletion; changes.patch records that deletion.
  /^\.catalyst\/hosts\.json$/,
  /^\.claude\/rules\/skill-references\.md$/,
  /^\.catalyst\/findings\/current\.jsonl$/,
  /^\.codex\/agents\/[^/]+\.toml$/,
  /^\.claude\/scheduled_tasks\.lock$/,
];
// A tree whose HEAD, reflog or dirty files changed this recently may still have
// an agent in it (the LIVE check only sees a process cwd'd there right now).
const RECENT_HOURS = Number(process.env.CATALYST_PRUNE_RECENT_HOURS ?? 6);
// Classes whose work is on main or deliberately abandoned: a branch that
// `git branch -d` refuses (a squash merge leaves its commits unmerged) is
// bundled to the archive, then deleted with -D.
const BUNDLE_AND_DELETE = new Set(["MERGED", "CLOSED_NO_MERGE", "TICKET_SHIPPED", "TICKET_DONE"]);
const STALE_DAYS = Number(process.env.CATALYST_WORKTREE_STALE_DAYS) || 14;
const LINEARIS_MAX = Number(process.env.CATALYST_PRUNE_LINEARIS_MAX ?? 100);

// ─── tiny argv ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const CMD = ["apply", "candidates", "remove", "history", "explain"].includes(argv[0]) ? argv[0] : "scan";
const rest = CMD === "scan" ? argv : argv.slice(1);
const flag = (n) => rest.includes(`--${n}`);
const opt = (n) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const multi = (n) => rest.reduce((a, v, i) => (v === `--${n}` && rest[i + 1] ? [...a, rest[i + 1]] : a), []);
const AS_JSON = flag("json");
const INCLUDE_STALE = flag("include-stale");
const INCLUDE_SHIPPED = flag("include-shipped");
const NO_SIZES = flag("no-sizes");
const ACTOR = opt("actor") || process.env.CATALYST_PRUNE_ACTOR || "cli";
const say = (...a) => console.error(...a);

const USAGE =
  "usage: prune-worktrees.mjs [scan|apply|candidates|remove|history|explain] [flags]\n" +
  "  scan        [--json] [--include-stale] [--include-shipped] [--no-sizes]\n" +
  "  apply       [--json] [--include-stale] [--include-shipped] [--actor NAME]\n" +
  "  candidates  [--json] [--repo-root-substr S] [--min-size-kb N]\n" +
  "  remove      --path P [--path P …] --why " + '"reason"' + " [--actor NAME]\n" +
  "  history     [--limit N]\n" +
  "  explain     <ticket|branch|substring>\n";
if (flag("help")) {
  console.log(USAGE);
  process.exit(0);
}

// ─── roots (CTC-3644) ────────────────────────────────────────────────────────
class Refusal extends Error {}

// resolveRoots(env) → { worktrees, repoRoot, replicaDb, archive, source } or
// throws Refusal. paths.json first, then env, else refuse.
async function resolveRoots(env) {
  let machine;
  let file;
  try {
    file = machinePathsFile({ env });
    machine = await loadMachinePaths({ env });
  } catch (err) {
    throw new Refusal(`machine paths file unusable: ${err.message}`);
  }
  let roots;
  if (machine) {
    roots = {
      worktrees: machine.paths.worktrees,
      repoRoot: machine.paths.repoRoot,
      replicaDb: machine.paths.replicaDb ?? env.CATALYST_REPLICA_DB ?? null,
      source: `paths.json (${file})`,
    };
  } else {
    const wt = env.CATALYST_WORKTREES_DIR ?? env.CATALYST_WORK_TREES;
    if (!wt)
      throw new Refusal(
        "no worktrees root declared: no machine paths file and neither CATALYST_WORKTREES_DIR nor CATALYST_WORK_TREES is set"
      );
    if (!wt.startsWith("/")) throw new Refusal(`worktrees root must be an absolute path, got ${JSON.stringify(wt)}`);
    roots = {
      worktrees: wt,
      repoRoot: env.CATALYST_REPO_ROOT ? resolve(env.CATALYST_REPO_ROOT) : null,
      replicaDb: env.CATALYST_REPLICA_DB ?? null,
      source: env.CATALYST_WORKTREES_DIR ? "env CATALYST_WORKTREES_DIR" : "env CATALYST_WORK_TREES",
    };
  }
  roots.worktrees = resolve(roots.worktrees);
  if (roots.worktrees === "/" || roots.worktrees === resolve(HOME))
    throw new Refusal(`worktrees root ${roots.worktrees} is / or $HOME; declare the farm directory itself`);
  if (!existsSync(roots.worktrees) || !statSync(roots.worktrees).isDirectory())
    throw new Refusal(`worktrees root not found: ${roots.worktrees} (from ${roots.source})`);
  roots.archive = resolve(env.CATALYST_WT_ARCHIVE || join(dirname(roots.worktrees), "wt-cleanup-archive"));
  return roots;
}

let ROOTS = null; // set in main for the commands that need a farm
const underRoot = (p) => resolve(p).startsWith(ROOTS.worktrees + "/");
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

// ─── discovery ───────────────────────────────────────────────────────────────
function discover(root) {
  const leaves = [];
  const clones = [];
  const strays = [];
  const probe = (d) => {
    const g = join(d, ".git");
    if (!existsSync(g)) return null;
    try {
      return statSync(g).isFile() ? readFileSync(g, "utf8").trim() : "DIR";
    } catch {
      return null;
    }
  };
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const pdir = join(root, project.name);
    const hit = probe(pdir);
    if (hit === "DIR") {
      clones.push(pdir);
      continue;
    }
    if (hit) {
      leaves.push({ path: pdir, pointer: hit });
      continue;
    }
    let kids = 0;
    for (const sub of readdirSync(pdir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      kids++;
      const sdir = join(pdir, sub.name);
      const hit2 = probe(sdir);
      if (hit2 === "DIR") {
        clones.push(sdir);
        continue;
      }
      if (hit2) {
        leaves.push({ path: sdir, pointer: hit2 });
        continue;
      }
      strays.push(sdir);
    }
    if (kids === 0) strays.push(pdir);
  }
  return { leaves, clones, strays };
}

function ownerOf(pointer) {
  const m = /^gitdir:\s*(.+)$/.exec(pointer);
  if (!m) return null;
  const i = m[1].lastIndexOf("/.git/worktrees/");
  return i > 0 ? m[1].slice(0, i) : null;
}

// `git worktree list --porcelain` for one owner repo → [{ path, branch, detached, locked }].
// Throws when git fails, which skips the whole repo.
function listWorktrees(owner) {
  const out = execFileSync("git", ["-C", owner, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const rows = [];
  for (const block of out.split("\n\n")) {
    const row = { path: null, branch: null, detached: false, locked: false, bare: false };
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) row.path = line.slice(9);
      else if (line.startsWith("branch ")) row.branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "detached") row.detached = true;
      else if (line === "bare") row.bare = true;
      else if (line === "locked" || line.startsWith("locked ")) row.locked = true;
    }
    if (row.path && !row.bare) rows.push(row);
  }
  return rows;
}

// ─── LIVE: processes cwd'd inside a tree ─────────────────────────────────────
// Replaces the retired classifier's live-session join. Every process cwd the
// OS will show us: `lsof -d cwd` on macOS, /proc/*/cwd on Linux. The scan must
// see this process's own cwd, or it is treated as failed (fail closed).
function processCwds() {
  const lsof = process.env.CATALYST_PRUNE_LSOF || (process.platform === "darwin" ? "lsof" : null);
  const cwds = [];
  if (lsof) {
    const r = spawnSync(lsof, ["-a", "-d", "cwd", "-Fpn", "-w"], { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new Error(`${lsof}: ${r.error.message}`);
    let pid = null;
    for (const line of String(r.stdout || "").split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (line.startsWith("n") && pid) cwds.push({ pid, cwd: line.slice(1) });
    }
  } else if (process.platform === "linux") {
    for (const d of readdirSync("/proc")) {
      if (!/^\d+$/.test(d)) continue;
      try {
        cwds.push({ pid: Number(d), cwd: readlinkSync(`/proc/${d}/cwd`) });
      } catch { /* another user's process, or gone */ }
    }
  } else {
    throw new Error(`no process scan for platform ${process.platform}`);
  }
  const self = real(process.cwd());
  if (!cwds.some((c) => c.pid === process.pid && real(c.cwd) === self))
    throw new Error(`process scan did not see this process (pid ${process.pid}) cwd'd at ${self}; ${cwds.length} cwd(s) read`);
  return cwds;
}

// liveHolders(tree, cwds) → pids whose cwd is the tree or inside it.
function liveHolders(tree, cwds) {
  const t = real(tree);
  return cwds.filter((c) => c.cwd === t || c.cwd.startsWith(t + "/")).map((c) => c.pid);
}

// ─── keep rules (CTC-3654) ───────────────────────────────────────────────────
// A release or deploy tree can be the input of a later build: infra's build-R6.sh
// reads a prior release tree's gitignored native build output. On 2026-09-27 the
// cleanup removed 12 idle, clean deploy-3072373-R* trees whose HEAD was in main,
// and the R7 build failed. An in-use check cannot see that, because the trees were
// idle. Such trees, and any tree opted out by a keep file, are reported and never
// removed, by `apply` or `remove` alike.
const PROTECTED_NAME = /^(deploy|release)-|-R\d+(-|$)/;
function keepReason(path, branch) {
  const name = basename(path);
  if (PROTECTED_NAME.test(name)) return `protected name ${name}`;
  if (branch && PROTECTED_NAME.test(basename(branch))) return `protected branch ${branch}`;
  if (existsSync(join(path, ".catalyst", "keep-worktree"))) return "keep file .catalyst/keep-worktree";
  const listFile = join(ROOTS.worktrees, ".keep-worktrees");
  try {
    const list = readFileSync(listFile, "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
    if (list.some((l) => l === name || resolve(ROOTS.worktrees, l) === resolve(path))) return `listed in ${listFile}`;
  } catch { /* no farm keep list */ }
  return null;
}

// ─── PR evidence ─────────────────────────────────────────────────────────────
const FRESH_DAYS = 2;
const TICKET_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/i;

function allPrs(owner) {
  // CTC-3640: one retry. A single failed read on 2026-09-27 01:41Z kept all 138
  // catalyst-cloud trees for that run.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const out = execFileSync(
        "gh",
        ["pr", "list", "--state", "all", "--limit", "20000", "--json", "number,title,headRefName,state"],
        { cwd: owner, encoding: "utf8", timeout: 300_000, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }
      );
      return JSON.parse(out);
    } catch (err) {
      say(`  [${basename(owner)}] gh pr list failed (attempt ${attempt}/2): ${String(err.stderr || err.message).split("\n").find((l) => l.trim())?.slice(0, 160)}`);
    }
  }
  return null; // fail-closed: no PR evidence for this repo
}

function defaultRemoteRef(owner) {
  try {
    return execFileSync("git", ["-C", owner, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "origin/main";
  }
}

function headInRef(path, ref) {
  try {
    execFileSync("git", ["-C", path, "merge-base", "--is-ancestor", "HEAD", ref], { encoding: "utf8", timeout: 30_000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Pick one state for a set of PRs: any open wins, then merged, then closed.
function summarize(prs) {
  if (prs.some((p) => p.state === "OPEN")) return { state: "open", pr: prs.find((p) => p.state === "OPEN") };
  if (prs.some((p) => p.state === "MERGED")) return { state: "merged", pr: prs.find((p) => p.state === "MERGED") };
  return { state: "closed", pr: prs[0] };
}

// ─── Linear evidence ─────────────────────────────────────────────────────────
// Replica first: one read for the whole run. Else linearis: one `issues read`
// per ticket that reaches this check, capped per run. Else no Linear trigger.
const DONE_TYPES = new Set(["completed", "canceled", "duplicate"]);
const DONE_NAMES = new Set(["done", "canceled", "cancelled", "duplicate"]);

async function makeLinear(replicaDb) {
  if (replicaDb) {
    try {
      const map = await readReplica(replicaDb);
      return { source: `replica ${replicaDb}`, get: (t) => map.get(t) ?? null };
    } catch (err) {
      say(`  WARN: Linear replica unreadable (${replicaDb}): ${String(err.message).slice(0, 120)}`);
    }
  }
  if (process.env.CATALYST_PHASE) {
    say("  WARN: no Linear replica, and CATALYST_PHASE is set, so linearis is skipped; no ticket-Done trigger this run");
    return { source: "none", get: () => null };
  }
  if (!onPath("linearis")) {
    say("  WARN: no Linear replica and linearis is not on PATH; no ticket-Done trigger this run");
    return { source: "none", get: () => null };
  }
  const cache = new Map();
  let reads = 0;
  let capped = false;
  return {
    source: "linearis",
    get(ticket) {
      if (cache.has(ticket)) return cache.get(ticket);
      if (reads >= LINEARIS_MAX) {
        if (!capped) say(`  WARN: linearis read cap reached (${LINEARIS_MAX}); later tickets get no Linear trigger this run`);
        capped = true;
        return null;
      }
      reads++;
      let state = null;
      try {
        // stdin closed: linearis consumes stdin otherwise.
        const out = execFileSync("linearis", ["issues", "read", ticket], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
        // Only the live workflow state's name: never a top-level status or
        // type field, which can be stale (CTC-3654). A renamed Done stage
        // matches nothing here, which keeps the tree: the safe direction.
        const name = JSON.parse(out)?.state?.name;
        if (name) state = { type: DONE_NAMES.has(String(name).toLowerCase()) ? "completed" : "other", name };
      } catch (err) {
        say(`  WARN: linearis issues read ${ticket} failed: ${String(err.stderr || err.message).split("\n").find((l) => l.trim())?.slice(0, 120)}`);
      }
      cache.set(ticket, state);
      return state;
    },
  };
}

// The workflow state joined by state_id is the source of truth. issues.state_type
// and issues.state go stale: 509 of 7,660 rows disagreed on 2026-09-27, and
// CTC-3632 read `completed` after it was reopened to Todo (CTC-3654). An issue
// with no joined state gives no row, which means no Linear evidence.
async function readReplica(path) {
  if (!existsSync(path)) throw new Error("file not found");
  const rows = await (async () => {
    try {
      const { Database } = await import("bun:sqlite");
      const db = new Database(path, { readonly: true });
      try {
        return db.query(REPLICA_SQL).all();
      } finally {
        db.close();
      }
    } catch (err) {
      if (!/bun:sqlite|Cannot find (module|package)|ERR_UNSUPPORTED_ESM_URL_SCHEME/.test(String(err.message))) throw err;
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        return db.prepare(REPLICA_SQL).all();
      } finally {
        db.close();
      }
    }
  })();
  const map = new Map();
  for (const r of rows) map.set(String(r.id).toUpperCase(), { type: r.type, name: r.name });
  return map;
}
const REPLICA_SQL =
  "SELECT i.identifier AS id, s.type AS type, s.name AS name " +
  "FROM issues i JOIN workflow_states s ON s.id = i.state_id WHERE i.archived_at IS NULL OR i.archived_at = ''";

function onPath(bin) {
  return String(process.env.PATH || "").split(delimiter).some((d) => d && existsSync(join(d, bin)));
}

// ─── classification ──────────────────────────────────────────────────────────
// Classes, in the order they are decided:
//   PROTECTED         a release/deploy name or a keep file (keepReason; never touched)
//   LIVE              a process has its cwd inside the tree (never touched)
//   MERGED / CLOSED_NO_MERGE  a PR whose head is the branch, or its Mergify stack
//                     rename `stack/<user>/<branch>/…`, merged / closed unmerged
//   ACTIVE            open PR, locked worktree, or no evidence and younger than STALE_DAYS
//   STALE             no evidence, older than STALE_DAYS (--include-stale)
//   HEAD_IN_MAIN      no PR, HEAD already in origin's default branch (no commit lost)
//   TICKET_SHIPPED    no PR of its own; its ticket has a merged PR, none open (--include-shipped)
//   TICKET_DONE       no open PR; its ticket is Done/Canceled/Duplicate in Linear (--include-shipped)
// Trees younger than FRESH_DAYS are never promoted past ACTIVE/STALE: a
// just-created tree sits at main with no PR while its agent is starting.
function classifyRepo(owner, entries, { prs, cwds, linear }) {
  const byHead = new Map();
  const byStackBase = new Map();
  const byTicket = new Map();
  const push = (m, k, v) => (m.has(k) ? m.get(k).push(v) : m.set(k, [v]));
  for (const p of prs ?? []) {
    push(byHead, p.headRefName, p);
    const s = /^stack\/[^/]+\/(.+?)\/[^/]+$/.exec(p.headRefName);
    if (s) push(byStackBase, s[1], p);
    const tickets = new Set(`${p.title} ${p.headRefName}`.toUpperCase().match(new RegExp(TICKET_RE.source, "gi")) ?? []);
    for (const t of tickets) push(byTicket, t.toUpperCase(), p);
  }
  const mainRef = defaultRemoteRef(owner);
  const now = Date.now();

  return entries.map((wt) => {
    const ticket = (wt.branch && TICKET_RE.exec(wt.branch)?.[1]?.toUpperCase()) || null;
    const ageDays = (() => {
      try {
        return (now - statSync(wt.path).mtimeMs) / 86_400_000;
      } catch {
        return 0;
      }
    })();
    const r = { path: wt.path, branch: wt.branch, ticket, prNumber: null, prState: "none", ageDays, liveSessions: 0 };
    const set = (classification, reason) => Object.assign(r, { classification, reason });
    const keep = keepReason(wt.path, wt.branch);
    if (keep) return set("PROTECTED", keep);
    if (!cwds) return set("LIVE", "process scan failed; every tree is treated as live");
    const holders = liveHolders(wt.path, cwds);
    r.liveSessions = holders.length;
    if (holders.length) return set("LIVE", `process cwd'd here (pid ${holders.slice(0, 3).join(", ")})`);
    if (wt.locked) return set("ACTIVE", "worktree is locked");

    const idle = `idle ${Math.round(ageDays)}d`;
    const fallback = () => (ageDays > STALE_DAYS ? "STALE" : "ACTIVE");
    const staleNote = ageDays > STALE_DAYS ? "> stale window" : "< stale window";
    if (!prs) return set(fallback(), `no PR evidence (gh failed), ${idle} (${staleNote})`);

    const own = [...(wt.branch ? byHead.get(wt.branch) ?? [] : []), ...(wt.branch ? byStackBase.get(wt.branch) ?? [] : [])];
    if (own.length) {
      const { state, pr } = summarize(own);
      const via = byHead.has(wt.branch) ? "head branch" : `Mergify stack rename ${pr.headRefName}`;
      r.prNumber = pr.number;
      r.prState = state;
      if (state === "merged") return set("MERGED", `PR #${pr.number} merged, matched via ${via}`);
      if (state === "closed") return set("CLOSED_NO_MERGE", `PR #${pr.number} closed without merge, matched via ${via}`);
      return set("ACTIVE", `PR #${pr.number} open`);
    }
    set(fallback(), `no PR found, ${idle} (${staleNote})`);
    if (ageDays < FRESH_DAYS) return set(r.classification, `${r.reason}, fresh (<${FRESH_DAYS}d), not promoted`);
    if (headInRef(wt.path, mainRef)) return set("HEAD_IN_MAIN", `no PR; HEAD is already in ${mainRef}, removal loses no commit`);
    const tprs = ticket ? byTicket.get(ticket) ?? [] : [];
    const summary = tprs.length ? summarize(tprs) : null;
    if (summary?.state === "merged") return set("TICKET_SHIPPED", `no PR of its own; ticket ${ticket} shipped in PR #${summary.pr.number}, none open`);
    if (summary?.state === "open") return set(r.classification, `no PR of its own; ticket ${ticket} still has open PR #${summary.pr.number}`);
    // CTC-3640: a finished ticket is evidence on its own. 126 of the 289 audit
    // removals on 2026-09-27 had nothing else: no PR matched the tree's branch.
    const lin = ticket ? linear.get(ticket) : null;
    if (lin && DONE_TYPES.has(lin.type))
      return set("TICKET_DONE", `no open PR; ticket ${ticket} is ${lin.name} in Linear${summary ? ` (its PRs closed unmerged, e.g. #${summary.pr.number})` : ""}`);
    if (summary) return set(r.classification, `no PR of its own; ticket ${ticket} PRs all closed unmerged (e.g. #${summary.pr.number})`);
    return set(r.classification, `${r.reason}; ${wt.branch ? "branch has unique commits, no ticket PR" : `detached HEAD with commits not in ${mainRef}`}${lin ? ` (ticket ${lin.name})` : ""}`);
  });
}

// One gh call per repo: {number -> {updatedAt, isDraft}} for OPEN PRs, the
// staleness signals for candidates mode. Returns {} on any gh failure.
function openPrInfo(owner) {
  try {
    const out = execFileSync(
      "gh",
      ["pr", "list", "--state", "open", "--limit", "500", "--json", "number,updatedAt,isDraft"],
      { cwd: owner, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }
    );
    return new Map(JSON.parse(out).map((p) => [p.number, p]));
  } catch {
    return new Map();
  }
}

function lastCommitDays(owner, branch) {
  if (!branch) return null;
  try {
    const out = execFileSync("git", ["-C", owner, "log", "-1", "--format=%ct", `refs/heads/${branch}`], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const ct = Number(out.trim());
    return Number.isFinite(ct) ? (Date.now() / 1000 - ct) / 86400 : null;
  } catch {
    return null;
  }
}

// NOTE ON SIZES: per-tree `du` reports LOGICAL bytes. bun (and pnpm) install
// via APFS clonefile/hardlinks, so node_modules across worktrees share physical
// blocks and du sums double-count. sizeKb ranks trees; `apply` measures the
// real `df` delta and logs it as physicalFreedKb. Trust df.
function dataAvailKb() {
  try {
    const out = execFileSync("df", ["-k", dirname(ROOTS.worktrees)], { encoding: "utf8" });
    return Number(out.trim().split("\n").pop().split(/\s+/)[3]) || 0;
  } catch {
    return 0;
  }
}

function dirSizeKb(p) {
  try {
    return Number(execFileSync("du", ["-sk", p], { encoding: "utf8", timeout: 300_000 }).split("\t")[0]) || 0;
  } catch {
    return 0;
  }
}

// Deterministic hints: the agent or user still decides.
function hints({ ageDays, commitDays, prInfo }) {
  const h = [];
  const openDays = prInfo?.updatedAt ? (Date.now() / 1000 - Date.parse(prInfo.updatedAt) / 1000) / 86400 : null;
  if (prInfo?.isDraft) h.push("draft PR");
  if (openDays != null && openDays >= 30 && (commitDays == null || commitDays >= 30))
    h.push(`PR silent: open ${Math.round(openDays)}d, last commit ${commitDays != null ? Math.round(commitDays) + "d" : "unknown"} ago`);
  if (commitDays != null && commitDays >= 60) h.push(`branch untouched ${Math.round(commitDays)}d`);
  if (ageDays >= 14) h.push(`worktree idle ${Math.round(ageDays)}d`);
  return { hints: h, prOpenDays: openDays != null ? Math.round(openDays) : null, commitAgeDays: commitDays != null ? Math.round(commitDays) : null };
}

// ─── fail-closed removal ─────────────────────────────────────────────────────
const git = (args, opts = {}) =>
  execFileSync("git", args, { encoding: "utf8", timeout: 300_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });

// Every changed path in the tree (tracked edits and untracked files, one entry
// per file). Returns null when git cannot say, which keeps the tree.
function dirtyPaths(path) {
  try {
    const out = git(["-C", path, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]);
    const entries = [];
    const parts = out.split("\0").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const code = parts[i].slice(0, 2);
      entries.push({ code, file: parts[i].slice(3) });
      if (code[0] === "R" || code[0] === "C") i++; // skip a rename's source path
    }
    return entries;
  } catch {
    return null;
  }
}

// Newest mtime among the worktree's HEAD, its reflog, and its dirty files. Not
// the index: `git status` rewrites it on every scan.
function newestTouchMs(path, dirty) {
  let newest = 0;
  const bump = (p) => {
    try {
      newest = Math.max(newest, statSync(p).mtimeMs);
    } catch { /* gone: ignore */ }
  };
  try {
    const gd = resolve(path, git(["-C", path, "rev-parse", "--git-dir"]).trim());
    for (const f of ["HEAD", "logs/HEAD"]) bump(join(gd, f));
  } catch { /* no admin dir: nothing to add */ }
  for (const d of dirty ?? []) bump(join(path, d.file));
  return newest;
}

function archiveDir(owner, path) {
  const dir = join(ROOTS.archive, new Date().toISOString().slice(0, 10), `${basename(owner)}__${basename(path)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Archive trivial residue: tracked edits as a patch, untracked files as a tar.
function archiveResidue(path, dirty, dir) {
  const tracked = dirty.filter((d) => d.code !== "??").map((d) => d.file);
  const untracked = dirty.filter((d) => d.code === "??").map((d) => d.file);
  if (tracked.length) writeFileSync(join(dir, "changes.patch"), git(["-C", path, "diff", "HEAD", "--", ...tracked]));
  if (untracked.length) execFileSync("tar", ["-czf", join(dir, "untracked.tar.gz"), "-C", path, ...untracked], { timeout: 300_000 });
}

function removeTree(owner, path, branch, { classification = null, reason = null } = {}) {
  const rec = { path, branch, action: null };
  const keep = keepReason(path, branch);
  if (keep) {
    rec.action = "kept-protected";
    rec.error = `${keep}; delete the keep file or rename the tree to remove it`;
    return rec;
  }
  if (!underRoot(path)) {
    rec.action = "refused";
    rec.error = "outside the worktrees root";
    return rec;
  }
  // Re-check LIVE right before removal: an agent may have started since the scan.
  let holders;
  try {
    holders = liveHolders(path, processCwds());
  } catch (err) {
    rec.action = "kept-live";
    rec.error = `process scan failed, treated as live: ${String(err.message).slice(0, 120)}`;
    return rec;
  }
  if (holders.length) {
    rec.action = "kept-live";
    rec.error = `process cwd'd here (pid ${holders.slice(0, 3).join(", ")})`;
    return rec;
  }
  const dirty = dirtyPaths(path);
  if (dirty === null) {
    rec.action = "kept-dirty";
    rec.error = "git status failed; nothing removed";
    return rec;
  }
  const touched = newestTouchMs(path, dirty);
  if (RECENT_HOURS > 0 && touched && Date.now() - touched < RECENT_HOURS * 3600_000) {
    rec.action = "kept-recent";
    rec.error = `touched ${((Date.now() - touched) / 3600_000).toFixed(1)}h ago (< ${RECENT_HOURS}h)`;
    return rec;
  }
  const nonTrivial = dirty.filter((d) => !TRIVIAL_DIRTY.some((re) => re.test(d.file)));
  if (nonTrivial.length) {
    rec.action = "kept-dirty";
    rec.error = `${nonTrivial.length} non-residue change(s), e.g. ${nonTrivial.slice(0, 3).map((d) => d.file).join(", ")}`;
    return rec;
  }
  let dir = null;
  try {
    if (dirty.length) {
      dir = archiveDir(owner, path);
      archiveResidue(path, dirty, dir);
      rec.archived = dirty.map((d) => d.file);
      rec.archive = dir;
    }
    // --force only when every change was residue and is now archived.
    git(["-C", owner, "worktree", "remove", ...(dirty.length ? ["--force"] : []), path]);
  } catch (err) {
    rec.action = "kept-dirty";
    rec.error = String(err.stderr || err.message).split("\n").find((l) => l.trim())?.slice(0, 160) || "unknown";
    return rec;
  }
  rec.action = "removed";
  if (branch) deleteBranch(owner, branch, classification, rec, () => (dir = dir ?? archiveDir(owner, path)));
  if (rec.archive) {
    try {
      writeFileSync(join(rec.archive, "meta.json"), JSON.stringify({ path, owner, branch, classification, reason, archived: rec.archived ?? [], note: rec.note ?? null, ts: new Date().toISOString() }, null, 2));
    } catch { /* the run log still records it */ }
  }
  return rec;
}

function deleteBranch(owner, branch, classification, rec, getDir) {
  try {
    git(["-C", owner, "branch", "-d", branch]);
    return;
  } catch { /* unmerged by ancestry; a squash merge always lands here */ }
  if (!BUNDLE_AND_DELETE.has(classification)) {
    rec.note = "branch kept (not merged into HEAD)";
    return;
  }
  try {
    const dir = getDir();
    const bundle = join(dir, "unpushed.bundle");
    git(["-C", owner, "bundle", "create", bundle, branch, `^${defaultRemoteRef(owner)}`]);
    git(["-C", owner, "bundle", "verify", bundle]);
    git(["-C", owner, "branch", "-D", branch]);
    rec.archive = dir;
    rec.note = `branch deleted after bundling its commits (${classification})`;
  } catch (err) {
    rec.note = `branch kept: bundle failed (${String(err.stderr || err.message).split("\n").find((l) => l.trim())?.slice(0, 100)})`;
  }
}

// ─── run log ─────────────────────────────────────────────────────────────────
function logRun(record) {
  try {
    mkdirSync(join(LOG_ROOT, "worktree-prune"), { recursive: true });
    appendFileSync(RUN_LOG, JSON.stringify(record) + "\n");
  } catch (err) {
    say(`WARN: could not write run log ${RUN_LOG}: ${err.message}`);
  }
}

function readHistory(limit) {
  if (!existsSync(RUN_LOG)) return [];
  const lines = readFileSync(RUN_LOG, "utf8").split("\n").filter(Boolean);
  const out = [];
  for (const l of lines.slice(-limit)) {
    try {
      out.push(JSON.parse(l));
    } catch {
      /* tolerate torn lines */
    }
  }
  return out;
}

// ─── shared scan pipeline ────────────────────────────────────────────────────
const PRUNABLE_CLASSES = new Set([
  "MERGED", "CLOSED_NO_MERGE", "HEAD_IN_MAIN",
  ...(INCLUDE_STALE ? ["STALE"] : []),
  ...(INCLUDE_SHIPPED ? ["TICKET_SHIPPED", "TICKET_DONE"] : []),
]);

async function buildPlan({ wantProtected = false, sizes = true } = {}) {
  const WT_ROOT = ROOTS.worktrees;
  const { leaves, clones, strays } = discover(WT_ROOT);
  say(`root=${WT_ROOT} (${ROOTS.source}) · ${leaves.length} worktrees · ${clones.length} clones skipped · ${strays.length} stray dirs`);

  let cwds = null;
  let liveScanError = null;
  try {
    cwds = processCwds();
  } catch (err) {
    liveScanError = String(err.message).slice(0, 300);
    say(`  WARN: process scan failed (${liveScanError}); every tree is treated as LIVE and nothing will be removed`);
  }
  const linear = await makeLinear(ROOTS.replicaDb);

  const byOwner = new Map();
  for (const l of leaves) {
    const owner = ownerOf(l.pointer);
    if (!owner) {
      say(`  unparseable gitdir pointer: ${l.path}`);
      continue;
    }
    if (!byOwner.has(owner)) {
      byOwner.set(owner, []);
      if (ROOTS.repoRoot && !resolve(owner).startsWith(ROOTS.repoRoot + "/"))
        say(`  note: ${owner} is outside the repo root (${ROOTS.repoRoot})`);
    }
    byOwner.get(owner).push(l.path);
  }

  const plan = {
    root: WT_ROOT, roots: { ...ROOTS }, liveScan: { ok: !liveScanError, error: liveScanError, processes: cwds?.length ?? 0 },
    linearSource: linear.source, repos: [], strays, clones, totals: {},
  };
  const T = (plan.totals = {
    leaves: leaves.length, prunable: 0, prunableKb: 0, removed: 0, keptDirty: 0,
    protected: 0, keptProtected: 0, unregistered: 0,
  });

  for (const [owner, paths] of [...byOwner.entries()].sort()) {
    const repo = { owner, prunable: [], candidates: [], protectedCounts: {}, unregistered: [], error: null };
    let rows;
    try {
      const listed = listWorktrees(owner);
      const farm = new Set(paths.map(real));
      const entries = listed.filter((w) => farm.has(real(w.path)));
      rows = classifyRepo(owner, entries, { prs: entries.length ? allPrs(owner) : [], cwds, linear });
    } catch (err) {
      repo.error = String(err.message).slice(0, 200);
      say(`  [${basename(owner)}] SKIP ALL: ${repo.error}`);
      plan.repos.push(repo);
      continue;
    }
    const byPath = new Map(rows.map((r) => [real(r.path), r]));
    const prInfo = wantProtected ? openPrInfo(owner) : new Map();

    for (const p of paths) {
      const row = byPath.get(real(p));
      if (!row) {
        repo.unregistered.push(p);
        T.unregistered++;
        continue;
      }
      const kb = sizes ? dirSizeKb(p) : 0;
      if (PRUNABLE_CLASSES.has(row.classification)) {
        T.prunable++;
        T.prunableKb += kb;
        repo.prunable.push({
          path: p, branch: row.branch, ticket: row.ticket, prNumber: row.prNumber,
          prState: row.prState, classification: row.classification, reason: row.reason,
          ageDays: Math.round(row.ageDays * 10) / 10, sizeKb: kb,
        });
        continue;
      }
      repo.protectedCounts[row.classification] = (repo.protectedCounts[row.classification] || 0) + 1;
      T.protected++;
      if (row.classification === "PROTECTED") T.keptProtected++;
      // Every protected tree is recorded with its reason, so the run log answers
      // "why was this kept?" without re-running anything.
      repo.protected = repo.protected || [];
      repo.protected.push({ path: p, branch: row.branch, classification: row.classification, reason: row.reason });
      if (!wantProtected) continue;
      const info = row.prNumber ? prInfo.get(row.prNumber) : null;
      const commitDays = lastCommitDays(owner, row.branch);
      const { hints: hs, prOpenDays, commitAgeDays } = hints({ ageDays: row.ageDays, commitDays, prInfo: info });
      repo.candidates.push({
        path: p, branch: row.branch, ticket: row.ticket, prNumber: row.prNumber,
        classification: row.classification, reason: row.reason, liveSessions: row.liveSessions,
        ageDays: Math.round(row.ageDays * 10) / 10, sizeKb: kb,
        prOpenDays, commitAgeDays, hints: hs,
      });
    }
    say(`  [${basename(owner)}] prunable=${repo.prunable.length} protected=${JSON.stringify(repo.protectedCounts)}`);
    plan.repos.push(repo);
  }
  return plan;
}

// ─── commands ────────────────────────────────────────────────────────────────
// Group every kept tree by the shape of its reason, so a human sees at a glance
// what is holding space instead of one class name.
function reasonSummary(plan) {
  const counts = new Map();
  for (const r of plan.repos)
    for (const x of r.protected || []) {
      const key = `${x.classification}: ${String(x.reason || "").replace(/#\d+|\d+d|pid [\d, ]+|[A-Z][A-Z0-9]+-\d+|stack\/\S+/g, "…")}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  say("\nkept, by reason:");
  for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) say(`  ${String(n).padStart(4)}  ${k}`);
}

// A failed process scan still reports, but exits 3 so a scheduler flags it.
const liveScanExit = (plan) => {
  if (!plan.liveScan.ok) process.exitCode = 3;
};

async function cmdScan() {
  const plan = await buildPlan({ wantProtected: false, sizes: !NO_SIZES });
  logRun({ ts: new Date().toISOString(), mode: "scan", actor: ACTOR, root: ROOTS.worktrees, totals: plan.totals,
    includeStale: INCLUDE_STALE, includeShipped: INCLUDE_SHIPPED, liveScan: plan.liveScan,
    prunable: plan.repos.flatMap((r) => r.prunable.map((x) => ({ ...x, owner: r.owner }))),
    protected: plan.repos.flatMap((r) => (r.protected || []).map((x) => ({ ...x, owner: r.owner }))) });
  reasonSummary(plan);
  const gb = (plan.totals.prunableKb / 1024 / 1024).toFixed(1);
  say(`\nprunable: ${plan.totals.prunable} (nominal ~${gb} GB via du; shared cloned node_modules means PHYSICAL reclaim will be less), protected: ${plan.totals.protected} (kept-protected: ${plan.totals.keptProtected}), unregistered: ${plan.totals.unregistered}`);
  say(`run with 'apply' to remove these (still fail-closed per tree). Full log: ${RUN_LOG}`);
  liveScanExit(plan);
  out(plan);
}

async function cmdApply() {
  logRun({ ts: new Date().toISOString(), mode: "apply-started", actor: ACTOR, root: ROOTS.worktrees, note: "in progress; an apply-started line without a later apply line means the run died mid-way" });
  const availBefore = dataAvailKb();
  const plan = await buildPlan({ wantProtected: false });
  for (const repo of plan.repos) {
    if (repo.error) continue;
    for (const c of repo.prunable) {
      const rec = removeTree(repo.owner, c.path, c.branch, { classification: c.classification, reason: c.reason });
      Object.assign(c, rec);
      if (rec.action === "removed") plan.totals.removed++;
      else if (rec.action === "kept-recent") plan.totals.keptRecent = (plan.totals.keptRecent || 0) + 1;
      else if (rec.action === "kept-live") plan.totals.keptLive = (plan.totals.keptLive || 0) + 1;
      else if (rec.action === "kept-protected") plan.totals.keptProtected++;
      else plan.totals.keptDirty++;
      if (rec.action === "removed") say(`  removed ${c.path}`);
      else say(`  KEPT    ${c.path} (${rec.action}): ${rec.error}`);
    }
    try {
      execFileSync("git", ["-C", repo.owner, "worktree", "prune"], { encoding: "utf8", timeout: 120_000, stdio: "ignore" });
    } catch { /* best-effort admin-record cleanup */ }
  }
  for (const s of plan.strays) {
    try {
      if (underRoot(s) && readdirSync(s).length === 0) rmSync(s);
    } catch { /* non-empty: leave */ }
  }
  const gb = (plan.totals.prunableKb / 1024 / 1024).toFixed(1);
  plan.totals.physicalFreedKb = Math.max(0, dataAvailKb() - availBefore);
  const pgb = (plan.totals.physicalFreedKb / 1024 / 1024).toFixed(1);
  reasonSummary(plan);
  say(`\nremoved: ${plan.totals.removed} worktrees, kept-dirty: ${plan.totals.keptDirty}, kept-recent: ${plan.totals.keptRecent || 0}, kept-live: ${plan.totals.keptLive || 0}, kept-protected: ${plan.totals.keptProtected}, protected: ${plan.totals.protected}`);
  say(`space: nominal ${gb} GB (du, double-counts cloned node_modules); PHYSICAL freed per df: ${pgb} GB`);
  logRun({ ts: new Date().toISOString(), mode: "apply", actor: ACTOR, root: ROOTS.worktrees, totals: plan.totals,
    includeStale: INCLUDE_STALE, includeShipped: INCLUDE_SHIPPED, liveScan: plan.liveScan,
    result: plan.repos.flatMap((r) => r.prunable.map((x) => ({ ...x, owner: r.owner }))),
    protected: plan.repos.flatMap((r) => (r.protected || []).map((x) => ({ ...x, owner: r.owner }))) });
  liveScanExit(plan);
  out(plan);
}

async function cmdCandidates() {
  const sub = opt("repo-root-substr");
  const minSize = Number(opt("min-size-kb") || 0);
  const plan = await buildPlan({ wantProtected: true });
  const cands = plan.repos
    .filter((r) => !sub || r.owner.includes(sub))
    .flatMap((r) => r.candidates.map((c) => ({ ...c, owner: r.owner })))
    .filter((c) => c.sizeKb >= minSize)
    .sort((a, b) => b.sizeKb - a.sizeKb);
  const report = { candidates: cands, count: cands.length, totalKb: cands.reduce((s, c) => s + c.sizeKb, 0) };
  say(`\n${cands.length} protected worktrees reviewed, ${(report.totalKb / 1024 / 1024).toFixed(1)} GB held; present these to the user or fan out per-repo review subagents (see SKILL.md)`);
  out(report);
}

function cmdRemove() {
  const paths = multi("path").map((p) => resolve(p));
  const why = opt("why");
  if (!paths.length || !why) {
    say("remove requires at least one --path and a --why reason (recorded in the run log).");
    process.exit(2);
  }
  const { leaves } = discover(ROOTS.worktrees);
  const leafByPath = new Map(leaves.map((l) => [resolve(l.path), l]));
  const results = [];
  for (const p of paths) {
    if (!underRoot(p)) {
      results.push({ path: p, action: "refused", error: "outside the worktrees root" });
      say(`  REFUSED ${p}: outside the worktrees root ${ROOTS.worktrees}`);
      continue;
    }
    const leaf = leafByPath.get(p);
    if (!leaf) {
      results.push({ path: p, action: "refused", error: "not a registered worktree leaf under the farm" });
      say(`  REFUSED ${p}: not a worktree leaf under the farm (unregistered dir or full clone; inspect by hand)`);
      continue;
    }
    const owner = ownerOf(leaf.pointer);
    const branch = (() => {
      try {
        return execFileSync("git", ["-C", p, "branch", "--show-current"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
      } catch {
        return null;
      }
    })();
    const rec = removeTree(owner, p, branch);
    results.push(rec);
    say(`  ${rec.action === "removed" ? "removed" : "KEPT"} ${p}${rec.error ? `: ${rec.error}` : ""}`);
  }
  logRun({ ts: new Date().toISOString(), mode: "remove", actor: ACTOR, root: ROOTS.worktrees, why, result: results });
  out({ mode: "remove", why, results });
  if (results.some((r) => r.action === "refused" || r.action === "kept-protected")) process.exit(1);
}

function cmdHistory() {
  const limit = Number(opt("limit") || 20);
  const runs = readHistory(limit);
  if (!runs.length) {
    say(`no runs logged yet (${RUN_LOG})`);
    out([]);
    return;
  }
  for (const r of runs) {
    const t = r.totals || {};
    say(
      `${r.ts}  ${String(r.mode).padEnd(7)} by ${String(r.actor).padEnd(8)} ` +
        `prunable=${t.prunable ?? "-"} removed=${t.removed ?? "-"} kept-dirty=${t.keptDirty ?? "-"} ` +
        `protected=${t.protected ?? "-"}${r.why ? `  why: ${r.why}` : ""}`
    );
  }
  out(runs);
}

function cmdExplain() {
  const needle = (rest.find((a) => !a.startsWith("--")) || "").toLowerCase();
  if (!needle) {
    say("explain needs a ticket/branch/substring, e.g. explain CTL-1889");
    process.exit(2);
  }
  const hits = [];
  for (const r of readHistory(1000)) {
    const entries = [...(r.prunable || []), ...(r.result || []), ...(r.protected || [])];
    for (const e of entries) {
      const blob = `${e.path} ${e.branch} ${e.ticket} ${r.why || ""}`.toLowerCase();
      if (blob.includes(needle)) hits.push({ run: { ts: r.ts, mode: r.mode, actor: r.actor, why: r.why }, entry: e });
    }
  }
  if (!hits.length) say(`no history matches '${needle}'; this tree was never pruned by this tool.`);
  else for (const h of hits) say(`${h.run.ts} ${h.run.mode} ${h.entry.path} [${h.entry.action || h.entry.classification}]${h.entry.reason ? ` reason: ${h.entry.reason}` : ""}${h.run.why ? ` why: ${h.run.why}` : ""}`);
  out(hits);
}

function out(obj) {
  process.stdout.write(AS_JSON ? JSON.stringify(obj, null, 2) + "\n" : "\n");
}

// ─── main ────────────────────────────────────────────────────────────────────
try {
  if (["scan", "apply", "candidates", "remove"].includes(CMD)) ROOTS = await resolveRoots(process.env);
  switch (CMD) {
    case "scan": await cmdScan(); break;
    case "apply": await cmdApply(); break;
    case "candidates": await cmdCandidates(); break;
    case "remove": cmdRemove(); break;
    case "history": cmdHistory(); break;
    case "explain": cmdExplain(); break;
  }
} catch (err) {
  if (err instanceof Refusal) {
    say(`prune-worktrees: refusing to run, nothing was touched: ${err.message}`);
    say("Declare the farm in the installer's paths.json (role `worktrees`), or export CATALYST_WORKTREES_DIR.");
    process.exit(2);
  }
  say(`ERROR: ${err.message}`);
  say(USAGE);
  process.exit(1);
}
