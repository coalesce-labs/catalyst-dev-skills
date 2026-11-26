// create-pr-end-state.test.mjs — after create-pr, an open pull request is owned, handed off, or
// reported as needing attention. A reason alone never counts as an owner.
//
// Run: bun test tests/create-pr-end-state.test.mjs
//
// The script under test is skills/create-pr/scripts/pr-end-state.sh, run as shipped against
// stand-in `gh` and `catalyst` binaries, with real `nohup`, `pgrep`, `ps`, `jq` and `git`. The
// arm function it runs is the published one, loaded from the skill's own waiter reference, and
// the create block is run as the reference publishes it.

import { expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const skillDir = join(root, "skills/create-pr");
const script = join(skillDir, "scripts/pr-end-state.sh");
const REPO = "coalesce-labs/example";
// A tool the controls need that is in none of these is taken from the first directory of this
// machine's own PATH that has it (Homebrew keeps jq in /opt/homebrew/bin).
const SYSTEM_DIRS = ["/usr/local/bin", "/usr/bin", "/bin"];
for (const name of ["bash", "git", "jq", "nohup", "pgrep", "ps"]) {
  if (SYSTEM_DIRS.some((d) => existsSync(join(d, name)))) continue;
  const found = (process.env.PATH ?? "").split(":").find((d) => d.startsWith("/") && existsSync(join(d, name)));
  if (found) SYSTEM_DIRS.push(found);
}
// The Git the controls run with: the first `git` in END_STATE_TEST_GIT_DIR when that names a directory (a
// build of another version, for the version matrix), else on the system path.
const GIT_DIR_OVERRIDE = process.env.END_STATE_TEST_GIT_DIR || "";
const REAL_GIT = [GIT_DIR_OVERRIDE, ...SYSTEM_DIRS].filter(Boolean).map((d) => join(d, "git")).find((f) => existsSync(f)) ?? "git";
// The ref storage formats this Git can create (reftable needs Git 2.45), so the controls that depend on how
// refs are stored run once for each, on whatever this machine has.
const REF_FORMATS = ["files"];
{
  const probe = mkdtempSync(join(tmpdir(), "create-pr-end-fmt-"));
  if (spawnSync(REAL_GIT, ["init", "-q", "--ref-format=reftable", probe], { encoding: "utf8" }).status === 0) REF_FORMATS.push("reftable");
  rmSync(probe, { recursive: true, force: true });
}
const LONG = 30000;

// A branch name no other control uses, with no part that reads as a ticket key.
let serial = 0;
const freshBranch = () => `endstate-w${process.pid}x${++serial}`;
const refOf = (branch) => `${REPO}:${branch}`;
// The name of a branch's log inside .catalyst, as the arm writes it: the branch with every character outside
// A-Za-z0-9._- turned into "-" and cut to 80, then 32 hex of Git's blob hash of "<repository, lowercase>:<branch>".
const blobSha1 = (text) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex");
const slugOf = (branch) => branch.replace(/[^A-Za-z0-9._-]/g, "-");
const logNameOf = (branch, repo = REPO) => `waiter.${slugOf(branch).slice(0, 80)}.${blobSha1(`${repo.toLowerCase()}:${branch}`).slice(0, 32)}.log`;
// The first line an arm writes in its log: which wait the log is.
const armLine = (branch, { pr = 77, ticket = "ENG-123", after = 100, repo = REPO } = {}) =>
  `waiter-arm ${JSON.stringify({ repo: repo.toLowerCase(), branch, pr, ticket, after })}\n`;

// The system tool directories a control runs with. A control for a machine with no `catalyst`
// CLI must not find one there either, so a directory that holds one is replaced by a shadow of
// it: a link to every other tool in it, and no `catalyst`.
// The directory of the Git under test comes first and goes through the same filter as the others: a build
// directory that also holds a `catalyst` would hand one to a control for a machine with none.
function systemPath(dir, withoutCatalyst, dirs = [GIT_DIR_OVERRIDE, ...SYSTEM_DIRS].filter(Boolean)) {
  if (!withoutCatalyst) return dirs.join(":");
  return dirs.map((d, i) => {
    if (!existsSync(join(d, "catalyst"))) return d;
    const shadow = join(dir, `tools-${i}`);
    mkdirSync(shadow);
    for (const name of readdirSync(d)) if (name !== "catalyst") symlinkSync(join(d, name), join(shadow, name));
    return shadow;
  }).join(":");
}

// One seat per control: stand-in tools on PATH, and a real git checkout on `branch` with one
// commit, which is the head the stand-in `gh` reports for the pull request.
function makeSeat(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "create-pr-end-"));
  const bin = join(dir, "bin");
  const calls = join(dir, "calls");
  const seat = join(dir, "seat");
  mkdirSync(bin);
  mkdirSync(seat);
  mkdirSync(join(dir, "home"));
  writeFileSync(calls, "");
  const tool = (name, body) => writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  // A rename of the waiter state fails when FAIL_STATE_MV is set; every other move is the system's.
  // With FAIL_STATE_MV_ONCE naming a file that does not exist yet, only the first such rename fails.
  // FAIL_LOG_MV refuses the rename that gives a new waiter log its name.
  tool("mv", `if [ -n "$FAIL_STATE_MV" ]; then for a in "$@"; do case "$a" in *branch-waiter.json) echo "mv: rename refused by the test" >&2; exit 1 ;; esac; done; fi
if [ -n "$FAIL_STATE_MV_ONCE" ] && [ ! -e "$FAIL_STATE_MV_ONCE" ]; then for a in "$@"; do case "$a" in *branch-waiter.json) : > "$FAIL_STATE_MV_ONCE"; echo "mv: rename refused once by the test" >&2; exit 1 ;; esac; done; fi
if [ -n "$FAIL_LOG_MV" ]; then for a in "$@"; do case "$a" in waiter.*.log) echo "mv: log rename refused by the test" >&2; exit 1 ;; esac; done; fi
exec /bin/mv "$@"`);
  // A removal of the file FAIL_RM_NAME names fails; every other removal is the system's.
  tool("rm", `if [ -n "$FAIL_RM_NAME" ]; then for a in "$@"; do if [ "$a" = "$FAIL_RM_NAME" ]; then echo "rm: removal refused by the test" >&2; exit 1; fi; done; fi
exec /bin/rm "$@"`);
  tool("gh", `echo "gh $*" >> "$CALL_LOG"
if [ "$1" = repo ]; then [ "$REPO_FAIL" != 1 ] || exit 1; echo "${REPO}"; exit 0; fi
if [ "$1" = pr ] && [ "$2" = create ]; then echo "https://github.com/${REPO}/pull/77"; exit 0; fi
if [ "$1" = api ]; then
  if [ "$GH_FAIL" != 0 ]; then echo "gh: HTTP 502" >&2; exit 1; fi
  merged=false; state="$PR_STATE"
  if [ -n "$PR_STATE_FILE" ] && [ -s "$PR_STATE_FILE" ]; then state=$(cat "$PR_STATE_FILE"); fi
  if [ "$state" = unreadable ]; then echo "gh: HTTP 502" >&2; exit 1; fi
  if [ "$state" = merged ]; then merged=true; state=closed; fi
  sha="$PR_HEAD_SHA"; if [ -n "$PR_HEAD_FILE" ] && [ -s "$PR_HEAD_FILE" ]; then sha=$(cat "$PR_HEAD_FILE"); fi
  json=$(printf '{"merged":%s,"state":"%s","head":{"sha":"%s"},"base":{"repo":{"full_name":"%s"}}}' "$merged" "$state" "$sha" "$PR_REPO_NAME")
  if [ "$3" = --jq ]; then printf '%s' "$json" | jq -r "$4"; else printf '%s\\n' "$json"; fi
  exit 0
fi
exit 0`);
  if (!options.noCli) {
    tool("catalyst", `echo "catalyst $*" >> "$CALL_LOG"
if [ "$1 $2" = "events status" ]; then
  if [ "$STATUS_RC" != 0 ]; then exit "$STATUS_RC"; fi
  if [ -n "$MOVE_PR_ON_STATUS" ]; then printf '%s' "$MOVE_PR_ON_STATUS" > "$PR_HEAD_FILE"; fi
  if [ -n "$MOVE_STATE_ON_STATUS" ]; then printf '%s' "$MOVE_STATE_ON_STATUS" > "$PR_STATE_FILE"; fi
  if [ -n "$MOVE_ON_STATUS" ]; then git -c core.hooksPath=/dev/null -c user.name=Seat -c user.email=seat@example.com commit -q --allow-empty -m moved >/dev/null 2>&1; fi
  echo '{"head": 100}'; exit 0
fi
if [ "$1 $2" = "events wait-for" ]; then
  if [ -n "$WAIT_HOLD" ]; then n=0; while [ ! -e "$WAIT_HOLD" ] && [ "$n" -lt 600 ]; do sleep 0.1; n=$((n + 1)); done; fi
  sleep "$WAIT_SLEEP"
  if [ -n "$WAIT_EVENT" ]; then printf '%s\n' "$WAIT_EVENT"; exit 0; fi
  if [ -n "$WAIT_EXIT" ]; then echo "events: the filter was refused" >&2; exit "$WAIT_EXIT"; fi
  echo "events: no matching event within 1 s" >&2
  exit 1
fi
exit 0`);
  }
  // A `git` between the script and the real one, for the controls that ask for it. It runs the real command,
  // and then, after the FLIP_AFTER-th call that reads the checkout (not a call that only finds the repository,
  // lists tracked files or hashes a name), switches the checkout to FLIP_TO: a second writer moving it between
  // two reads. DUBIOUS answers the search for the checkout's root as a Git that refuses another user's files.
  // OBSERVE_LOG names a file that gets one line for each such call. OLD_GIT answers as a Git before 2.36, with
  // no `worktree list -z`. DIE_MID makes `worktree list` print a whole record for FORGED_BRANCH at FORGED_SHA
  // and then fail, as a Git that dies part way through its listing.
  if (options.gitShim) {
    tool("git", `real="${REAL_GIT}"
case " $* " in
  *" worktree list "*)
    if [ -n "$DIE_MID" ]; then printf 'worktree %s\\0HEAD %s\\0branch refs/heads/%s\\0\\0' "$PWD" "$FORGED_SHA" "$FORGED_BRANCH"; exit 128; fi ;;
esac
if [ -n "$OLD_GIT" ]; then
  case " $* " in
    *" --version "*) echo "git version 2.34.1"; exit 0 ;;
    *" worktree list "*" -z"*) echo "error: unknown switch z" >&2; exit 129 ;;
  esac
fi
if [ -n "$DUBIOUS" ]; then
  case " $* " in *" --show-toplevel "*) echo "fatal: detected dubious ownership in repository at '$PWD'" >&2; exit 128 ;; esac
fi
"$real" "$@"; rc=$?
[ -n "$OBSERVE_LOG" ] || exit $rc
case " $* " in *" ls-files "*|*" hash-object "*|*" --show-toplevel "*|*" --git-dir "*|*" --absolute-git-dir "*|*" --git-common-dir "*|*" --version "*) exit $rc ;; esac
echo "git $*" >> "$OBSERVE_LOG"
if [ -n "$FLIP_TO" ] && [ "$(wc -l < "$OBSERVE_LOG")" -eq "\${FLIP_AFTER:-1}" ]; then
  "$real" -c core.hooksPath=/dev/null switch -q "$FLIP_TO" >/dev/null 2>&1
fi
exit $rc`);
  }
  const branch = options.branch ?? freshBranch();
  const env = {
    PATH: `${bin}:${systemPath(dir, options.noCli === true)}`,
    HOME: join(dir, "home"),
    CALL_LOG: calls,
    PR_STATE: "open",
    PR_HEAD_SHA: "",
    GH_FAIL: "0",
    STATUS_RC: "0",
    WAIT_SLEEP: "20",
    WAITER_TIMEOUT_SECONDS: "60",
    GIT_CONFIG_NOSYSTEM: "1",
    // This test process stands for the agent session. The controls that find the session
    // through the process tree drop this and run under bash by another name (runUnder).
    PR_END_STATE_OWNER_PID: String(process.pid),
  };
  const git = (...args) => spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Seat", "-c", "user.email=seat@example.com", ...args], { cwd: seat, env, encoding: "utf8" });
  const initArgs = ["init", "-q", "-b", branch];
  if (options.refFormat && options.refFormat !== "files") initArgs.push(`--ref-format=${options.refFormat}`);
  if (options.separateGitDir) initArgs.push("--separate-git-dir", join(dir, "gitdir"));
  expect(git(...initArgs).status).toBe(0);
  expect(git("commit", "-q", "--allow-empty", "-m", "work").status).toBe(0);
  env.PR_HEAD_SHA = git("rev-parse", "HEAD").stdout.trim();
  expect(env.PR_HEAD_SHA).toMatch(/^[0-9a-f]{40}$/);
  return { dir, seat, calls, env, branch, ref: refOf(branch), git };
}

function run(s, args, extraEnv = {}, cwd = s.seat) {
  return spawnSync("bash", [script, ...args], { cwd, env: { ...s.env, ...extraEnv }, encoding: "utf8", timeout: LONG });
}

const record = (s, pr = 77, ticket = "ENG-123", extraEnv = {}, cwd = s.seat) => run(s, ["record", REPO, s.branch, String(pr), ticket], extraEnv, cwd);
const handoff = (s, ...rest) => run(s, ["handoff", REPO, s.branch, "77", ...rest]);

// The command run as the child of bash under another name, with no owner pid given and one
// session name allowed. It stands for whatever sits above the command: an agent session, or a
// terminal multiplexer. No ancestor of the test run carries the allowed name, so the result does
// not depend on what started the tests. The other name is a link, not a copy: the process table
// names a process after the path it was started by, and macOS kills a copied system bash at start.
const SESSION_NAME = "agent-session";
function runUnder(s, name, args) {
  const real = spawnSync("bash", ["-c", "command -v bash"], { env: s.env, encoding: "utf8" }).stdout.trim();
  expect(real).toMatch(/^\//);
  const dir = join(s.dir, `as-${name}`);
  mkdirSync(dir, { recursive: true });
  const parent = join(dir, name);
  symlinkSync(real, parent);
  const env = { ...s.env, PR_END_STATE_SESSION_NAMES: SESSION_NAME };
  delete env.PR_END_STATE_OWNER_PID;
  // Two commands, so this bash stays as the parent and does not replace itself with the child.
  return spawnSync(parent, ["-c", 'bash "$0" "$@"; exit $?', script, ...args], { cwd: s.seat, env, encoding: "utf8", timeout: LONG });
}
const check = (s, pr = 77, extraEnv = {}, cwd = s.seat) => run(s, ["check", REPO, s.branch, String(pr)], extraEnv, cwd);
const endRecord = (s, pr = 77) => JSON.parse(readFileSync(join(s.seat, ".catalyst/create-pr-end.json"), "utf8"))[`${s.ref}#${pr}`];
const hasEndFile = (s) => existsSync(join(s.seat, ".catalyst/create-pr-end.json"));
const callLines = (s) => readFileSync(s.calls, "utf8").split("\n").filter(Boolean);
// The fake CLI writes its call line after its process starts, so a wait can show in the process table
// before its line is in the log. A line is looked for until it shows, for five seconds at most.
function callLinesWith(s, line) {
  for (let i = 0; i < 50 && !callLines(s).includes(line); i++) spawnSync("sleep", ["0.1"]);
  return callLines(s);
}

// The waits a control left running for one ref, found the way the waiter's own liveness check
// finds them. `pgrep` leaves itself out, and this process never carries the pattern.
function waitPids(ref) {
  const esc = ref.replace(/[\][+.*?{}()|^$\\]/g, "\\$&");
  const found = spawnSync("pgrep", ["-f", `catalyst events wait-for .* ${esc} `], { encoding: "utf8" });
  return found.stdout.split("\n").map((l) => l.trim()).filter(Boolean).map(Number);
}

// Out of the process table, or left in it as a zombie on a machine whose PID 1 reaps nothing.
function gone(pid) {
  for (let i = 0; i < 40; i++) {
    if (/^(Z.*)?$/.test(psField(pid, "stat"))) return true;
    spawnSync("sleep", ["0.1"]);
  }
  return false;
}

// A wait's own shell, the stand-in under it, and the sleep under that.
function treePids(pid) {
  const kids = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);
  return [pid, ...kids.flatMap(treePids)];
}
// Stop every wait on one ref, whole, and see each process out before the files it writes are removed.
function stopWaits(ref) {
  const pids = waitPids(ref).flatMap(treePids);
  for (const pid of pids) try { process.kill(pid, "SIGKILL"); } catch {}
  for (const pid of pids) gone(pid);
}
function cleanup(s) {
  stopWaits(s.ref);
  rmSync(s.dir, { recursive: true, force: true });
}

// A process that is not this test's child, so nothing here has to reap it. It stands for the
// session that armed a waiter.
function startOwner() {
  const out = spawnSync("bash", ["-c", "sleep 60 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" });
  const pid = Number(out.stdout.trim());
  expect(pid).toBeGreaterThan(1);
  return pid;
}
// A child whose parent never reaps it, so it stays in the process table as a zombie when killed.
function startUnreapedOwner(s) {
  const pidFile = join(s.dir, "unreaped-pid");
  const parent = spawn("bash", ["-c", 'sleep 60 & echo $! > "$0"; exec sleep 60', pidFile], { stdio: "ignore" });
  for (let i = 0; i < 100 && !(existsSync(pidFile) && /^\d+\n$/.test(readFileSync(pidFile, "utf8"))); i++) spawnSync("sleep", ["0.1"]);
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  expect(pid).toBeGreaterThan(1);
  // The parent has replaced itself with a sleep, which waits for no child.
  for (let i = 0; i < 100 && psField(parent.pid, "comm").replace(/^.*\//, "") !== "sleep"; i++) spawnSync("sleep", ["0.1"]);
  return { pid, parent };
}
const psField = (pid, field) => spawnSync("ps", ["-o", `${field}=`, "-p", String(pid)], { encoding: "utf8" }).stdout.trim().replace(/\s+/g, " ");
// A process's start time as the script records it: in UTC and the C locale, whatever zone this process runs in.
const psStarted = (pid) => spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { env: { ...process.env, TZ: "UTC", LC_ALL: "C" }, encoding: "utf8" }).stdout.trim().replace(/\s+/g, " ");

function endOwner(pid) {
  try { process.kill(pid, "SIGKILL"); } catch {}
  return gone(pid);
}

// The bash blocks of the shipped waiter reference, and the one that defines a given function.
const waiterBlock = (fn) =>
  [...readFileSync(join(skillDir, "assets/references/branch-waiter.md"), "utf8").matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.includes(`${fn}() {`));
// The published arm function alone, run in a directory of the test's choice.
function armIn(s, cwd, branch = s.branch, ticket = "ENG-123", extraEnv = {}) {
  const arm = waiterBlock("arm_branch_waiter");
  const out = spawnSync("bash", ["-c", `${arm}\narm_branch_waiter "$0" "$1" 77 "$2"`, REPO, branch, ticket], { cwd, env: { ...s.env, ...extraEnv }, encoding: "utf8", timeout: LONG });
  // The arm returns before its wait is sure to show in the process table.
  if (out.stdout.includes("branch-waiter: armed ")) {
    for (let i = 0; i < 50 && waitPids(refOf(branch)).length === 0; i++) spawnSync("sleep", ["0.1"]);
    expect(waitPids(refOf(branch)).length).toBeGreaterThan(0);
  }
  return out;
}
const waiterLog = (s) => join(s.seat, ".catalyst", logNameOf(s.branch));
// The log name an older copy of the waiter wrote: the branch's slug alone, and no first line of its own.
const oldWaiterLog = (s) => join(s.seat, `.catalyst/waiter.${slugOf(s.branch)}.log`);
// A second checkout of the branch, as another seat on the same machine has one.
function initCheckout(s, dir) {
  mkdirSync(dir, { recursive: true });
  const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "init", "-q", "-b", s.branch], { cwd: dir, env: s.env, encoding: "utf8" });
  expect(r.status).toBe(0);
}
function waitEnded(s) {
  for (let i = 0; i < 150; i++) {
    if (/^waiter-rc /m.test(readFileSync(waiterLog(s), "utf8")) && waitPids(s.ref).length === 0) return true;
    spawnSync("sleep", ["0.1"]);
  }
  return false;
}

function createBlock() {
  const text = readFileSync(join(skillDir, "references/push-and-create.md"), "utf8");
  const found = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.includes("gh pr create --title"));
  if (!found) throw new Error("push-and-create.md no longer has a bash block that creates the pull request");
  return found;
}
// The published blocks read the skill's directory from the environment, as a path and not as shell text.
const published = (s, extra = {}) => ({ ...s.env, CLAUDE_SKILL_DIR: skillDir, ...extra });
const RECORD_MARK = "# Record who owns the open pull request";
const runBlock = (s, block) =>
  spawnSync("bash", ["-c", `base=main\ntitle='test: end state'\nticket=ENG-123\nbranch='${s.branch}'\n${block}`], { cwd: s.seat, env: published(s), encoding: "utf8", timeout: LONG });

test("open with a ticket: record starts the published wait and names the process that reads its wake", () => {
  const s = makeSeat();
  try {
    const r = record(s);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^OWNED: a waiter is running on .* is alive and reads its wake at its next turn\./);
    expect(r.stdout).not.toContain("already running");
    const waits = waitPids(s.ref).length;
    expect(waits).toBeGreaterThan(0);
    // A second record starts nothing and says the wait was there already.
    const second = record(s);
    expect(second.stdout).toMatch(/^OWNED: .* The wait was already running/);
    expect(waitPids(s.ref).length).toBe(waits);
    const rec = endRecord(s);
    expect(rec.pr).toBe(77);
    expect(rec.end).toBe("waiter");
    expect(rec.head).toBe(s.env.PR_HEAD_SHA);
    expect(rec.owner.pid).toBe(process.pid);
    const waiter = JSON.parse(readFileSync(join(s.seat, ".catalyst/branch-waiter.json"), "utf8"))[s.ref];
    expect(waiter).toEqual({ pr: 77, ticket: "ENG-123", cursor: 100 });
    const c = check(s);
    expect(c.status).toBe(0);
    expect(c.stdout).toMatch(/^OWNED: /);
    // The wait that runs is the published one: whole seconds, filtered on the ticket.
    expect(callLinesWith(s, "catalyst events wait-for --ticket ENG-123 --after 100 --timeout 60")).toContain(
      "catalyst events wait-for --ticket ENG-123 --after 100 --timeout 60",
    );
  } finally {
    cleanup(s);
  }
}, LONG);

// The wait listens on the ticket it was armed with, so a message to another ticket does not wake it.
// CONTROL: the same pull request with the same ticket stays owned, before and after.
test("a wait that listens on another ticket does not own this pull request, for record and for check", () => {
  const s = makeSeat();
  const state = join(s.seat, ".catalyst/branch-waiter.json");
  try {
    expect(record(s, 77, "ENG-123").stdout).toMatch(/^OWNED: /);
    expect(record(s, 77, "ENG-123").stdout).toMatch(/^OWNED: .* The wait was already running/);
    expect(check(s).status).toBe(0);
    const waits = waitPids(s.ref).length;
    const r = record(s, 77, "ENG-456");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^NEEDS ATTENTION: .*listens on ticket ENG-123, not ENG-456/);
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "needs-attention", ticket: "ENG-456" });
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/^NEEDS ATTENTION: .*listens on ticket ENG-123, not ENG-456/m);
    // The running wait and its state were left alone.
    expect(waitPids(s.ref).length).toBe(waits);
    expect(JSON.parse(readFileSync(state, "utf8"))[s.ref]).toMatchObject({ pr: 77, ticket: "ENG-123" });
    // A record with the wait's own ticket makes it owned again.
    expect(record(s, 77, "ENG-123").stdout).toMatch(/^OWNED: /);
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "waiter", ticket: "ENG-123" });
    expect(check(s).status).toBe(0);
  } finally {
    cleanup(s);
  }
}, LONG);

// The published arm refuses to start without a ticket and writes the one it listens on into the state,
// so a running wait whose state holds no ticket listens on a ticket nothing here can name. It is not
// credited to the ticket being recorded. CONTROL: the same wait with its ticket back in the state is owned.
test("a running wait whose state names no ticket does not own the pull request for a recorded ticket", () => {
  const s = makeSeat();
  const state = join(s.seat, ".catalyst/branch-waiter.json");
  const setTicket = (value) => {
    const all = JSON.parse(readFileSync(state, "utf8"));
    if (value === undefined) delete all[s.ref].ticket;
    else all[s.ref].ticket = value;
    writeFileSync(state, JSON.stringify(all));
  };
  try {
    expect(record(s, 77, "ENG-123").stdout).toMatch(/^OWNED: /);
    const waits = waitPids(s.ref).length;
    setTicket(undefined);
    const r = record(s, 77, "ENG-123");
    expect(r.stdout).toMatch(/^NEEDS ATTENTION: .*listens on ticket unknown, not ENG-123/);
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "needs-attention", ticket: "ENG-123" });
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/^NEEDS ATTENTION: .*listens on ticket unknown, not ENG-123/m);
    expect(waitPids(s.ref).length).toBe(waits);
    setTicket("ENG-123");
    expect(record(s, 77, "ENG-123").stdout).toMatch(/^OWNED: /);
    expect(check(s).status).toBe(0);
  } finally {
    cleanup(s);
  }
}, LONG);

// The documented re-run passes "${ticket:-}", which is empty when the variable is unset. Such a record
// keeps the ticket saved for the pull request and compares the running wait with it.
// CONTROL: with the wait's own ticket saved, a record without one stays owned and keeps that ticket.
test("a record without a ticket compares the wait with the ticket saved for the pull request, and keeps it", () => {
  const s = makeSeat();
  try {
    expect(record(s, 77, "ENG-123").stdout).toMatch(/^OWNED: /);
    const same = record(s, 77, "");
    expect(same.stdout).toMatch(/^OWNED: .* The wait was already running/);
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "waiter", ticket: "ENG-123" });
    expect(check(s).status).toBe(0);
    const waits = waitPids(s.ref).length;
    expect(record(s, 77, "ENG-456").stdout).toMatch(/^NEEDS ATTENTION: .*listens on ticket ENG-123, not ENG-456/);
    const r = record(s, 77, "");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^NEEDS ATTENTION: .*listens on ticket ENG-123, not ENG-456/);
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "needs-attention", ticket: "ENG-456" });
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/^NEEDS ATTENTION: .*listens on ticket ENG-123, not ENG-456/m);
    expect(waitPids(s.ref).length).toBe(waits);
  } finally {
    cleanup(s);
  }
}, LONG);

// A command with no agent session above it keeps the reader on record only for the wait that reader
// was recorded for. A wait armed again in this checkout for another ticket is not read by it.
// CONTROL: a wait armed again for the same ticket keeps that reader.
test("a wait armed again for another ticket does not keep the reader recorded for the first", () => {
  const s = makeSeat();
  const gonePid = startOwner();
  const owner = startOwner();
  try {
    expect(endOwner(gonePid)).toBe(true);
    const none = { PR_END_STATE_OWNER_PID: String(gonePid) };
    expect(record(s, 77, "ENG-123", { PR_END_STATE_OWNER_PID: String(owner) }).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    expect(armIn(s, s.seat, s.branch, "ENG-123").stdout).toContain("branch-waiter: armed ");
    const kept = record(s, 77, "ENG-123", none);
    expect(kept.stdout).toMatch(/^OWNED: .*the reader on record was kept/);
    expect(endRecord(s)).toMatchObject({ end: "waiter", ticket: "ENG-123", owner: { pid: owner } });
    expect(check(s).status).toBe(0);
    stopWaits(s.ref);
    expect(armIn(s, s.seat, s.branch, "ENG-456").stdout).toContain("branch-waiter: armed ");
    const moved = record(s, 77, "ENG-456", none);
    expect(moved.status).toBe(0);
    expect(moved.stdout).toMatch(/^NEEDS ATTENTION: .*listens on ticket ENG-456, but the reader on record, .* was recorded for ticket ENG-123/);
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "needs-attention", ticket: "ENG-456" });
    expect(check(s).status).toBe(9);
  } finally {
    endOwner(owner);
    cleanup(s);
  }
}, LONG);

// The checkout is read again after the arm, because it can move while the arm reads the event stream.
// The stand-in commits on the branch when the arm asks for the stream's head.
// CONTROL: back on the pull request's head, the running wait is owned.
test("a checkout that moves while the wait is armed is not recorded as the owner", () => {
  const s = makeSeat();
  try {
    const r = record(s, 77, "ENG-123", { MOVE_ON_STATUS: "1" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^NEEDS ATTENTION: .*a wait is running on .*, but the pull request is at [0-9a-f]{40} and this branch is at [0-9a-f]{40}/);
    expect(endRecord(s).end).toBe("needs-attention");
    expect(check(s).status).toBe(9);
    expect(s.git("reset", "-q", "--hard", s.env.PR_HEAD_SHA).status).toBe(0);
    expect(record(s).stdout).toMatch(/^OWNED: .* The wait was already running/);
    expect(check(s).status).toBe(0);
  } finally {
    cleanup(s);
  }
}, LONG);

// The records, the waiter's state and log, and the directory its wait runs in are the checkout's, so a
// command run from a subdirectory reads and writes them at the checkout's root.
test("record and check run from a subdirectory use the checkout's root, so the wait, its log and the records are the checkout's", () => {
  const s = makeSeat();
  const sub = join(s.seat, "deep", "er");
  mkdirSync(sub, { recursive: true });
  const at = (args) => spawnSync("bash", [script, ...args], { cwd: sub, env: s.env, encoding: "utf8", timeout: LONG });
  try {
    const r = at(["record", REPO, s.branch, "77", "ENG-123"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^OWNED: /);
    expect(existsSync(join(sub, ".catalyst"))).toBe(false);
    expect(existsSync(join(s.seat, ".catalyst/branch-waiter.json"))).toBe(true);
    expect(existsSync(waiterLog(s))).toBe(true);
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "waiter", ticket: "ENG-123" });
    expect(at(["check", REPO, s.branch, "77"]).status).toBe(0);
    expect(check(s).status).toBe(0);
  } finally {
    cleanup(s);
  }
}, LONG);

test("a wait whose arming process has ended is not an owner: check says NEEDS ATTENTION while the wait still runs", () => {
  const s = makeSeat();
  const owner = startOwner();
  try {
    const r = record(s, 77, "ENG-123", { PR_END_STATE_OWNER_PID: String(owner) });
    expect(r.status).toBe(0);
    expect(endRecord(s).owner.pid).toBe(owner);
    // CONTROL: while that process lives, the same check passes.
    expect(check(s).status).toBe(0);
    expect(endOwner(owner)).toBe(true);
    const c = check(s);
    expect(waitPids(s.ref).length).toBeGreaterThan(0);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/^NEEDS ATTENTION: a wait is running on .* has ended, so nothing will read its wake\.$/m);
  } finally {
    endOwner(owner);
    cleanup(s);
  }
}, LONG);

// An exited process that its parent has not reaped keeps its number and its start time, so the
// start-time match alone would still call it alive. CONTROL: while it runs, the check passes.
test("a session that has exited but is not reaped is no owner, for check and for record", () => {
  const s = makeSeat();
  const { pid, parent } = startUnreapedOwner(s);
  try {
    expect(record(s, 77, "ENG-123", { PR_END_STATE_OWNER_PID: String(pid) }).stdout).toMatch(/^OWNED: /);
    const started = endRecord(s).owner.started;
    expect(endRecord(s).owner.pid).toBe(pid);
    expect(check(s).status).toBe(0);

    process.kill(pid, "SIGKILL");
    for (let i = 0; i < 40 && !psField(pid, "stat").startsWith("Z"); i++) spawnSync("sleep", ["0.1"]);
    expect(psField(pid, "stat")).toMatch(/^Z/);
    expect(psStarted(pid)).toBe(started);

    const c = check(s);
    expect(waitPids(s.ref).length).toBeGreaterThan(0);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/^NEEDS ATTENTION: a wait is running on .* has ended, so nothing will read its wake\.$/m);
    const again = record(s, 77, "ENG-123", { PR_END_STATE_OWNER_PID: String(pid) });
    expect(again.stdout).toMatch(/^NEEDS ATTENTION: /);
    expect(endRecord(s).reason).toContain("no agent session that will read its wake could be named");
  } finally {
    parent.kill("SIGKILL");
    endOwner(pid);
    cleanup(s);
  }
}, LONG);

test("a process that cannot be named is no owner: record says NEEDS ATTENTION and writes no waiter record", () => {
  const s = makeSeat();
  const owner = startOwner();
  try {
    expect(endOwner(owner)).toBe(true);
    const r = record(s, 77, "ENG-123", { PR_END_STATE_OWNER_PID: String(owner) });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^NEEDS ATTENTION: /);
    expect(endRecord(s).end).toBe("needs-attention");
    expect(endRecord(s).reason).toContain("no agent session that will read its wake could be named");
    expect(check(s).status).toBe(9);
  } finally {
    cleanup(s);
  }
}, LONG);

test("a checkout that is not on the pull request's head is not an owner", () => {
  const s = makeSeat();
  try {
    expect(record(s).status).toBe(0);
    expect(check(s).status).toBe(0);
    expect(s.git("commit", "-q", "--allow-empty", "-m", "not pushed").status).toBe(0);
    const moved = check(s);
    expect(moved.status).toBe(9);
    expect(moved.stderr).toMatch(/NEEDS ATTENTION: .* the pull request is at [0-9a-f]{40} and this branch is at [0-9a-f]{40}\./);
    expect(s.git("switch", "-q", "-c", "another-line").status).toBe(0);
    const elsewhere = check(s);
    expect(elsewhere.status).toBe(9);
    expect(elsewhere.stderr).toContain(`this checkout is on another-line, not on ${s.branch}`);
  } finally {
    cleanup(s);
  }
}, LONG);

// `record` holds the same rule as `check`: it used to say OWNED from a checkout that `check`
// then refused. CONTROL: the first test records OWNED from a checkout on the head.
test("record from a checkout that is not on the pull request's head does not say OWNED, and the check gives the same cause", () => {
  const s = makeSeat();
  try {
    expect(s.git("commit", "-q", "--allow-empty", "-m", "not pushed").status).toBe(0);
    const r = record(s);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("OWNED");
    expect(r.stdout).toMatch(/^NEEDS ATTENTION: pull request #77 is open and nothing owns it\. the pull request is at [0-9a-f]{40} and this branch is at [0-9a-f]{40}/);
    expect(endRecord(s).end).toBe("needs-attention");
    expect(endRecord(s).reason).toContain("this branch is at");
    const c = check(s);
    expect(c.status).toBe(9);
    // The recorded reason, then the command that records an owner once it is dealt with, with the saved ticket.
    expect(c.stderr).toMatch(/NEEDS ATTENTION: .* the pull request is at [0-9a-f]{40} and this branch is at [0-9a-f]{40}\. Once that is dealt with, run this: .*pr-end-state\.sh record .* 77 ENG-123$/m);
    // No wait was started for a checkout off the head, so none stops the next arm: once the
    // commit is pushed, the same command starts the wait and this session is its reader.
    expect(waitPids(s.ref)).toEqual([]);
    const pushed = { PR_HEAD_SHA: s.git("rev-parse", "HEAD").stdout.trim() };
    const again = record(s, 77, "ENG-123", pushed);
    expect(again.stdout).toMatch(/^OWNED: /);
    expect(again.stdout).not.toContain("already running");
    expect(check(s, 77, pushed).status).toBe(0);
  } finally {
    cleanup(s);
  }
}, LONG);

// The path for a pull request that already exists runs `record` and then `check`. On the head
// both pass. Run again from a checkout that has left the head, with the first run's wait still
// running, neither passes: a wait that is already running is not what makes an owner.
test("the existing pull request path: record then check pass on the head, and a wait already running does not make a checkout off the head an owner", () => {
  const s = makeSeat();
  try {
    const first = record(s);
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/^OWNED: /);
    const onHead = check(s);
    expect(onHead.status).toBe(0);
    expect(onHead.stdout).toMatch(/^OWNED: /);
    expect(waitPids(s.ref).length).toBeGreaterThan(0);

    expect(s.git("commit", "-q", "--allow-empty", "-m", "not pushed").status).toBe(0);
    const again = record(s);
    expect(again.status).toBe(0);
    expect(again.stdout).not.toContain("OWNED");
    expect(again.stdout).toMatch(/^NEEDS ATTENTION: pull request #77 is open and nothing owns it\. a wait is running on .*, but the pull request is at [0-9a-f]{40} and this branch is at [0-9a-f]{40}/);
    expect(waitPids(s.ref).length).toBeGreaterThan(0);
    expect(endRecord(s).end).toBe("needs-attention");
    const offHead = check(s);
    expect(offHead.status).toBe(9);
    expect(offHead.stderr).toMatch(/NEEDS ATTENTION: .* the pull request is at [0-9a-f]{40} and this branch is at [0-9a-f]{40}\./);
  } finally {
    cleanup(s);
  }
}, LONG);

// The existing pull request path records with the ticket and then exits, so the ticket has to be
// known by then. This runs, in the order the page gives them, the blocks above that path's record
// call that set the branch and the ticket, and records with what they left.
test("the preflight page finds the ticket before the existing pull request path records, so a ticket branch is owned", () => {
  const page = readFileSync(join(skillDir, "references/preflight.md"), "utf8");
  const call = page.indexOf('scripts/pr-end-state.sh" record');
  expect(call).toBeGreaterThan(-1);
  const blocks = [...page.slice(0, call).matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => /\b(branch|ticket)=/.test(b));
  // CONTROL: the filter finds the block that names the branch, wherever the ticket block is.
  expect(blocks.length).toBeGreaterThan(0);
  const s = makeSeat({ branch: `PROJ-${process.pid}${++serial}-end-state` });
  try {
    const r = spawnSync("bash", ["-c", `unset ticket\n${blocks.join("\n")}\nbash "$0" record "$1" "$branch" 77 "\${ticket:-}"`, script, REPO], { cwd: s.seat, env: published(s), encoding: "utf8", timeout: LONG });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^OWNED: a waiter is running on /m);
    const waiter = JSON.parse(readFileSync(join(s.seat, ".catalyst/branch-waiter.json"), "utf8"))[s.ref];
    expect(waiter.ticket).toBe(s.branch.match(/^PROJ-\d+/)[0]);
    expect(check(s).status).toBe(0);
  } finally {
    cleanup(s);
  }
}, LONG);

// A team key other than the fallback, on a line the file indents.
test("the preflight page reads an indented team key, so the existing pull request path records with that ticket", () => {
  const page = readFileSync(join(skillDir, "references/preflight.md"), "utf8");
  const blocks = [...page.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => /TEAM_KEY=/.test(b));
  expect(blocks.length).toBe(1);
  const s = makeSeat({ branch: `ENG-${process.pid}${++serial}-end-state` });
  try {
    mkdirSync(join(s.seat, ".catalyst"));
    writeFileSync(join(s.seat, ".catalyst/catalyst.toml"), '[project]\n  linear_team = "ENG"\n');
    const r = spawnSync("bash", ["-c", `unset ticket\n${blocks[0]}\nbash "$0" record "$1" "$branch" 77 "\${ticket:-}"`, script, REPO], { cwd: s.seat, env: published(s), encoding: "utf8", timeout: LONG });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^OWNED: a waiter is running on /m);
    expect(JSON.parse(readFileSync(join(s.seat, ".catalyst/branch-waiter.json"), "utf8"))[s.ref].ticket).toBe(s.branch.match(/^ENG-\d+/)[0]);
    // CONTROL: without the file the key is the fallback, which this branch does not carry.
    rmSync(join(s.seat, ".catalyst/catalyst.toml"));
    const none = spawnSync("bash", ["-c", `unset ticket\n${blocks[0]}\nprintf 'key=%s ticket=%s\\n' "$TEAM_KEY" "\${ticket:-}"`], { cwd: s.seat, env: published(s), encoding: "utf8", timeout: LONG });
    expect(none.stdout).toBe("key=PROJ ticket=\n");
    // A ticket left in the shell by an earlier branch does not stand in for this one's.
    const stale = spawnSync("bash", ["-c", `ticket=PROJ-9\n${blocks[0]}\nprintf 'key=%s ticket=%s\\n' "$TEAM_KEY" "\${ticket:-}"`], { cwd: s.seat, env: published(s), encoding: "utf8", timeout: LONG });
    expect(stale.stdout).toBe("key=PROJ ticket=\n");
  } finally {
    cleanup(s);
  }
}, LONG);

test("no ticket key: the reason is recorded, nothing owns the pull request, and only a handoff with a receipt changes that", () => {
  const s = makeSeat();
  try {
    const r = record(s, 77, "");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^NEEDS ATTENTION: pull request #77 is open and nothing owns it\. /);
    expect(r.stdout).toContain("ticket key");
    expect(waitPids(s.ref)).toEqual([]);
    expect(endRecord(s).end).toBe("needs-attention");
    expect(endRecord(s).reason).toContain("ticket key");
    const before = check(s);
    expect(before.status).toBe(9);
    expect(before.stderr).toMatch(/^NEEDS ATTENTION: .*ticket key/m);

    // Each of these is refused and leaves the record as it was: a reason in place of a message
    // id, a message nobody will read, an answer in other words, no answer, a recipient that is
    // not an address, and the two-part form with the answer inside the id.
    const refused = [
      ["ticket:ENG-123", "no CLI here", "next-turn"],
      ["ticket:ENG-123", "msg_01", "undeliverable"],
      ["ticket:ENG-123", "msg_01", "delivered"],
      ["ticket:ENG-123", "msg_01", ""],
      ["ticket:ENG-123", "msg_01"],
      ["ticket:ENG-123", "", "next-turn"],
      ["the lead", "msg_01", "next-turn"],
      ["ticket:eng-123", "msg_01", "next-turn"],
      ["session:", "msg_01", "next-turn"],
      ["", "msg_01", "next-turn"],
      ["ticket:ENG-123", "msg_01 next-turn"],
    ];
    for (const args of refused) {
      const bad = handoff(s, ...args);
      expect([args, bad.status]).toEqual([args, 2]);
    }
    expect(endRecord(s).end).toBe("needs-attention");
    expect(check(s).status).toBe(9);

    const h = handoff(s, "ticket:ENG-123", "msg_01", "next-turn");
    expect(h.status).toBe(0);
    expect(h.stdout).toMatch(/^HANDED-OFF: pull request #77 \(open\) was sent to ticket:ENG-123 \(message msg_01, next-turn\)\.$/m);
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "handoff", to: "ticket:ENG-123", message: "msg_01", answer: "next-turn" });
    const after = check(s);
    expect(after.status).toBe(0);
    expect(after.stdout).toMatch(/^HANDED-OFF: /);
    // A handoff for one pull request does not cover another on the same branch.
    expect(check(s, 78).status).toBe(9);
  } finally {
    cleanup(s);
  }
}, LONG);

test("a delivered handoff is read first: a running wait does not hide it, and a later record keeps it", () => {
  const s = makeSeat();
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    const waits = waitPids(s.ref).length;
    expect(waits).toBeGreaterThan(0);
    expect(handoff(s, "session:abc-123", "msg_02", "next-phase").status).toBe(0);
    const c = check(s);
    expect(waitPids(s.ref).length).toBe(waits);
    expect(c.status).toBe(0);
    expect(c.stdout).toBe("HANDED-OFF: pull request #77 was sent to session:abc-123 (message msg_02, next-phase).\n");
    const again = record(s);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/^HANDED-OFF: .* The record was kept and no wait was started\.$/m);
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "handoff", to: "session:abc-123", message: "msg_02", answer: "next-phase" });
    expect(check(s).status).toBe(0);
  } finally {
    cleanup(s);
  }
}, LONG);

test("a handoff record that is not in the delivered form does not pass, however it got there", () => {
  const s = makeSeat();
  try {
    mkdirSync(join(s.seat, ".catalyst"));
    const write = (rec) => writeFileSync(join(s.seat, ".catalyst/create-pr-end.json"), JSON.stringify({ [`${s.ref}#77`]: { pr: 77, end: "handoff", ...rec } }));
    for (const rec of [
      { to: "ticket:ENG-123", receipt: "no CLI here" },
      { to: "ticket:ENG-123", message: "msg_01", answer: "undeliverable" },
      { to: "somebody", message: "msg_01", answer: "next-turn" },
    ]) {
      write(rec);
      const c = check(s);
      expect([rec, c.status]).toEqual([rec, 9]);
      expect(c.stderr).toContain("is not a delivered one");
    }
    // CONTROL: the same file in the delivered form passes.
    write({ to: "ticket:ENG-123", message: "msg_01", answer: "next-turn" });
    expect(check(s).status).toBe(0);
  } finally {
    cleanup(s);
  }
}, LONG);

test("a process above the command that is not an agent session is no owner, even with a wait running", () => {
  const s = makeSeat();
  try {
    const r = runUnder(s, "tmux", ["record", REPO, s.branch, "77", "ENG-123"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^NEEDS ATTENTION: /);
    expect(endRecord(s).end).toBe("needs-attention");
    expect(endRecord(s).reason).toContain("no agent session that will read its wake could be named");
    expect(waitPids(s.ref).length).toBeGreaterThan(0);
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toContain("no agent session is on record as its reader");
    expect(c.stderr).toMatch(/in place of TICKET: bash .*pr-end-state\.sh record /);
    expect(c.stderr).toContain(`pr-end-state.sh record ${REPO} ${s.branch} 77 TICKET`);
  } finally {
    cleanup(s);
  }
}, LONG);

// CONTROL for the control above: the same bash under an allowed name is found through
// the process tree. It has ended by the time the check runs, and the check says so.
test("an agent session found through the process tree is the owner, and its end is noticed while the wait still runs", () => {
  const s = makeSeat();
  try {
    const r = runUnder(s, SESSION_NAME, ["record", REPO, s.branch, "77", "ENG-123"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^OWNED: .* agent-session \(pid [0-9]+\) is alive and reads its wake at its next turn\./);
    const rec = endRecord(s);
    expect(rec.end).toBe("waiter");
    expect(rec.owner.name).toBe(SESSION_NAME);
    expect(rec.owner.pid).not.toBe(process.pid);
    expect(gone(rec.owner.pid)).toBe(true);
    const c = check(s);
    expect(waitPids(s.ref).length).toBeGreaterThan(0);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/the session that armed it \(agent-session, pid [0-9]+\) has ended, so nothing will read its wake\./);
  } finally {
    cleanup(s);
  }
}, LONG);

test("the default session names are agent harnesses, never a shell, a terminal or a general runtime", () => {
  const found = readFileSync(script, "utf8").match(/^_PES_SESSION_NAMES="\$\{PR_END_STATE_SESSION_NAMES:-([^}]*)\}"$/m);
  expect(found).not.toBeNull();
  const names = found[1].split(" ");
  expect(names).toContain("claude");
  for (const never of ["sh", "bash", "zsh", "tmux", "screen", "sshd", "login", "systemd", "init", "launchd", "node", "bun", "python", "python3", "make"]) {
    expect(names).not.toContain(never);
  }
});

test("no catalyst CLI: nothing owns the pull request, and the reason says so", () => {
  const s = makeSeat({ noCli: true });
  try {
    const r = record(s);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^NEEDS ATTENTION: /);
    expect(endRecord(s).reason).toContain("catalyst CLI absent");
    expect(waitPids(s.ref)).toEqual([]);
    expect(check(s).status).toBe(9);
  } finally {
    cleanup(s);
  }
}, LONG);

test("a failed event status read on a first arm: nothing owns the pull request", () => {
  const s = makeSeat();
  try {
    const r = record(s, 77, "ENG-123", { STATUS_RC: "4" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^NEEDS ATTENTION: /);
    expect(endRecord(s).reason).toContain("catalyst events status failed");
    expect(waitPids(s.ref)).toEqual([]);
    expect(check(s).status).toBe(9);
  } finally {
    cleanup(s);
  }
}, LONG);

// The commands the closing step publishes, with this seat's values in their places.
function closingCommands(s) {
  const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  const step = skill.slice(skill.indexOf("5. **Arm the branch waiter"));
  const values = { "<owner/name>": REPO, "<branch>": s.branch, "<pr>": "77", "<ticket>": "ENG-123" };
  return [...step.matchAll(/`(bash "\$\{CLAUDE_SKILL_DIR\}\/scripts\/pr-end-state\.sh" [^`]+)`/g)].map((m) => m[1].replace(/<[a-z/]+>/g, (p) => values[p] ?? p));
}
const runClosing = (s, command) => spawnSync("bash", ["-c", command], { cwd: s.seat, env: published(s), encoding: "utf8", timeout: LONG });

// The event status read fails at the create step and works at the closing step.
test("a status read that fails at create and recovers: the closing step's own commands put a reader on record", () => {
  const block = createBlock();
  const s = makeSeat();
  try {
    const created = spawnSync("bash", ["-c", `base=main\ntitle='test: end state'\nticket=ENG-123\nbranch='${s.branch}'\n${block}`], { cwd: s.seat, env: published(s, { STATUS_RC: "4" }), encoding: "utf8", timeout: LONG });
    expect(created.status).toBe(0);
    expect(created.stdout).toMatch(/^NEEDS ATTENTION: pull request #77 is open and nothing owns it\. .*catalyst events status failed/m);
    expect(created.stdout).toContain("Do not report this run as finished unattended.");
    expect(waitPids(s.ref)).toEqual([]);

    const commands = closingCommands(s);
    expect(commands.map((c) => c.split(" ")[2])).toEqual(["record", "check"]);
    const [rec, chk] = commands.map((c) => runClosing(s, c));
    expect(rec.status).toBe(0);
    expect(rec.stdout).toMatch(/^OWNED: /);
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "waiter", owner: { pid: process.pid } });
    expect(chk.status).toBe(0);
    expect(chk.stdout).toMatch(/^OWNED: /);
    expect(waitPids(s.ref).length).toBeGreaterThan(0);
  } finally {
    cleanup(s);
  }
}, LONG);

// CONTROL for the control above: while the read still fails, the same two commands report it.
test("a status read that still fails at the closing step: its commands say NEEDS ATTENTION and why", () => {
  const s = makeSeat();
  try {
    s.env.STATUS_RC = "4";
    expect(record(s).status).toBe(0);
    const [rec, chk] = closingCommands(s).map((c) => runClosing(s, c));
    expect(rec.stdout).toMatch(/^NEEDS ATTENTION: /);
    expect(chk.status).toBe(9);
    expect(chk.stderr).toContain("catalyst events status failed");
  } finally {
    cleanup(s);
  }
}, LONG);

// The state the closing step used to leave: the published arm function starts a wait, and the
// record from the failed attempt still names no reader. The check says so and names the command.
test("the arm function alone, after a failed attempt, leaves no reader on record and the check names the command that does", () => {
  const s = makeSeat();
  try {
    expect(record(s, 77, "ENG-123", { STATUS_RC: "4" }).stdout).toMatch(/^NEEDS ATTENTION: /);
    const r = armIn(s, s.seat);
    expect(r.stdout).toContain("branch-waiter: armed ");
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toContain("no agent session is on record as its reader");
    expect(c.stderr).toMatch(/in place of TICKET: bash .*pr-end-state\.sh record /);
    expect(c.stderr).toContain(`pr-end-state.sh record ${REPO} ${s.branch} 77 TICKET`);
  } finally {
    cleanup(s);
  }
}, LONG);

test.each(["merged", "closed"])("a %s pull request is FINISHED: no wait is started and the check passes", (state) => {
  const s = makeSeat();
  try {
    const r = record(s, 77, "ENG-123", { PR_STATE: state });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`FINISHED: pull request #77 is ${state}; there is nothing to own.\n`);
    expect(endRecord(s)).toMatchObject({ pr: 77, end: state });
    expect(waitPids(s.ref)).toEqual([]);
    // CONTROL: the stand-ins do record calls, and no catalyst call was made.
    expect(callLines(s).some((l) => l.startsWith("gh api "))).toBe(true);
    expect(callLines(s).filter((l) => l.startsWith("catalyst "))).toEqual([]);
    expect(check(s, 77, { PR_STATE: state }).status).toBe(0);
  } finally {
    cleanup(s);
  }
}, LONG);

test("a pull request that cannot be read leaves no record, and neither command passes", () => {
  const s = makeSeat();
  try {
    const r = record(s, 77, "ENG-123", { GH_FAIL: "1" });
    expect(r.status).toBe(9);
    expect(r.stderr).toContain("Nothing was recorded");
    expect(hasEndFile(s)).toBe(false);
    expect(waitPids(s.ref)).toEqual([]);
    const c = check(s, 77, { GH_FAIL: "1" });
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/^NEEDS ATTENTION: could not read pull request #77/);
    expect(run(s, ["handoff", REPO, s.branch, "77", "ticket:ENG-123", "msg_01", "next-turn"], { GH_FAIL: "1" }).status).toBe(9);
    expect(hasEndFile(s)).toBe(false);
  } finally {
    cleanup(s);
  }
}, LONG);

test("an open pull request with no record and no wait fails the check, and the line names the command", () => {
  const s = makeSeat();
  try {
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toContain("has no waiter and no handoff on record");
    expect(c.stderr).toContain(`pr-end-state.sh record ${REPO} ${s.branch} 77`);
  } finally {
    cleanup(s);
  }
}, LONG);

test("a waiter that has ended is not an owner: the check reports its exit and says to arm again", () => {
  const s = makeSeat();
  try {
    mkdirSync(join(s.seat, ".catalyst"));
    writeFileSync(join(s.seat, ".catalyst/create-pr-end.json"), JSON.stringify({ [`${s.ref}#77`]: { pr: 77, end: "waiter", head: s.env.PR_HEAD_SHA, owner: { pid: process.pid, started: "x", name: "bun" } } }));
    // The log is under the name an older copy of the waiter wrote, with no first line of its own.
    writeFileSync(oldWaiterLog(s), "cursor 100\nwaiter-rc 124\n");
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/^NEEDS ATTENTION: pull request #77 is open and the waiter on .* is not running \(waiter-rc 124\)\. Handle its wake and arm it again/);
  } finally {
    cleanup(s);
  }
}, LONG);

test("a waiter armed for another pull request does not own this one", () => {
  const s = makeSeat();
  try {
    expect(record(s, 77).status).toBe(0);
    const c = check(s, 78);
    expect(c.status).toBe(9);
    expect(c.stderr).toContain("was armed for pull request #77");
    const r = record(s, 78);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^NEEDS ATTENTION: /);
    expect(endRecord(s, 78)).toMatchObject({ pr: 78, end: "needs-attention" });
    expect(endRecord(s, 78).reason).toContain("was armed for pull request #77, not #78");
    // The first pull request keeps its own record, so the same command leaves it owned.
    expect(endRecord(s, 77)).toMatchObject({ pr: 77, end: "waiter" });
    expect(check(s, 77).status).toBe(0);
    expect(check(s, 78).status).toBe(9);
    // The first pull request's wait was left alone.
    expect(JSON.parse(readFileSync(join(s.seat, ".catalyst/branch-waiter.json"), "utf8"))[s.ref].pr).toBe(77);
  } finally {
    cleanup(s);
  }
}, LONG);

// The published arm saves the ticket its wait listens on before the wait starts. A re-arm whose save
// fails would leave the old ticket in the state, and a reader on record for that ticket would read as
// the owner of a wait that does not listen on it, so the arm stops before it starts the wait.
// CONTROL: the same re-arm with a rename that works starts the wait and saves its ticket.
test("a re-arm that cannot save its state starts no wait and check reads no owner, and one that saves it arms", () => {
  const s = makeSeat();
  try {
    expect(record(s, 77, "ENG-123").stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    const state = join(s.seat, ".catalyst/branch-waiter.json");
    const before = readFileSync(state, "utf8");
    const failed = armIn(s, s.seat, s.branch, "ENG-456", { FAIL_STATE_MV: "1" });
    expect(failed.stderr).toContain("branch-waiter: cannot record ");
    expect(failed.stdout).not.toContain("branch-waiter: armed ");
    expect(waitPids(s.ref)).toEqual([]);
    expect(readFileSync(state, "utf8")).toBe(before);
    expect(readdirSync(join(s.seat, ".catalyst")).filter((n) => n.startsWith("branch-waiter.json."))).toEqual([]);
    expect(check(s).status).toBe(9);
    expect(armIn(s, s.seat, s.branch, "ENG-456").stdout).toContain("branch-waiter: armed ");
    expect(JSON.parse(readFileSync(state, "utf8"))[s.ref].ticket).toBe("ENG-456");
  } finally {
    cleanup(s);
  }
}, LONG);

// The wake handler tries a pending conflict retry on the first wake at or after its due time, and
// record never merges or pushes. So record arms a wait that ends when the retry is due, as the handler
// arms it, and keeps the retry: the next wake is the retry. CONTROL: with no retry pending, record arms
// the full wait.
const nowSec = () => Math.floor(Date.now() / 1000);
function waitTimeouts(s) {
  for (let i = 0; i < 50 && !callLines(s).some((l) => l.startsWith("catalyst events wait-for ")); i++) spawnSync("sleep", ["0.1"]);
  return callLines(s).filter((l) => l.startsWith("catalyst events wait-for ")).map((l) => Number(l.match(/--timeout (\d+)$/)[1]));
}
function pendIn(s, dueIn, logText) {
  stopWaits(s.ref);
  const state = join(s.seat, ".catalyst/branch-waiter.json");
  const st = JSON.parse(readFileSync(state, "utf8"));
  // The two fields the wake handler saves when it leaves a conflict retry for later.
  st[s.ref] = { ...st[s.ref], pending: 1, due: nowSec() + dueIn };
  writeFileSync(state, JSON.stringify(st));
  if (logText !== undefined) writeFileSync(waiterLog(s), logText);
  writeFileSync(s.calls, "");
  return st[s.ref];
}
const savedEntry = (s) => JSON.parse(readFileSync(join(s.seat, ".catalyst/branch-waiter.json"), "utf8"))[s.ref];

test("a stopped wait with a conflict retry pending is armed by record to end when the retry is due, and the retry is kept", () => {
  const s = makeSeat();
  try {
    expect(record(s, 77, "ENG-123").stdout).toMatch(/^OWNED: /);
    const saved = pendIn(s, 30);
    const first = check(s);
    expect(first.status).toBe(9);
    expect(first.stderr).toMatch(/^NEEDS ATTENTION: .* is not running\. A conflict retry is pending on .* record arms a wait that ends when it is due/m);
    // The wait ends at the due time: its timeout is that time less the clock read during record.
    const t0 = nowSec();
    const r = record(s);
    const t1 = nowSec();
    expect(r.stdout).toMatch(/^OWNED: /);
    const [secs] = waitTimeouts(s);
    expect(secs).toBeGreaterThanOrEqual(saved.due - t1);
    expect(secs).toBeLessThanOrEqual(saved.due - t0);
    expect(savedEntry(s)).toMatchObject({ pr: 77, ticket: "ENG-123", pending: 1, due: saved.due });
    expect(check(s).stdout).toMatch(/^OWNED: /);
    // An overdue retry: the wait ends at once, so the handler tries it on the next wake.
    const late = pendIn(s, -10);
    expect(record(s).stdout).toMatch(/^OWNED: /);
    expect(waitTimeouts(s)).toEqual([1]);
    expect(savedEntry(s)).toMatchObject({ pending: 1, due: late.due });
    // A wait that a signal ended (exit 143) with a retry pending is armed the same way.
    const p143 = pendIn(s, 20, "cursor 100\nwaiter-rc 143\n");
    const u0 = nowSec();
    expect(record(s).stdout).toMatch(/^OWNED: /);
    const u1 = nowSec();
    const [after143] = waitTimeouts(s);
    expect(after143).toBeGreaterThanOrEqual(p143.due - u1);
    expect(after143).toBeLessThanOrEqual(p143.due - u0);
    expect(savedEntry(s).pending).toBe(1);
    // CONTROL: no retry pending, the full wait.
    stopWaits(s.ref);
    const st = JSON.parse(readFileSync(join(s.seat, ".catalyst/branch-waiter.json"), "utf8"));
    delete st[s.ref].pending;
    delete st[s.ref].due;
    writeFileSync(join(s.seat, ".catalyst/branch-waiter.json"), JSON.stringify(st));
    writeFileSync(s.calls, "");
    expect(record(s).stdout).toMatch(/^OWNED: /);
    expect(waitTimeouts(s)).toEqual([60]);
  } finally {
    cleanup(s);
  }
}, LONG);

// Repository content is not trusted: a checkout can carry links in .catalyst, where the waiter and the
// record keep their files. Every write is made from inside the checkout's own .catalyst into a file
// created new, so a link is replaced and never followed, and nothing outside the checkout changes.
// Each case first reads its canary through the link it plants, so the link is known to lead outside.
function outsideDir(s) {
  const d = join(s.dir, "outside");
  mkdirSync(d, { recursive: true });
  return d;
}
function plant(s, out, name, text) {
  const target = join(out, `canary-${name}`);
  writeFileSync(target, text);
  mkdirSync(join(s.seat, ".catalyst"), { recursive: true });
  const link = join(s.seat, ".catalyst", name);
  rmSync(link, { force: true });
  symlinkSync(target, link);
  expect(readFileSync(link, "utf8")).toBe(text);
  return target;
}
// A link to a directory outside, holding one canary file: a move that follows the link would put its
// file inside that directory.
function plantDir(s, out, name) {
  const target = join(out, `dir-${name}`);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "canary"), "untouched\n");
  mkdirSync(join(s.seat, ".catalyst"), { recursive: true });
  symlinkSync(target, join(s.seat, ".catalyst", name));
  expect(readdirSync(join(s.seat, ".catalyst", name))).toEqual(["canary"]);
  return target;
}
const named = (path) => { try { lstatSync(path); return true; } catch { return false; } };
const plainFile = (path) => lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink();
const allBlocks = () => ["arm_branch_waiter", "handle_waiter_wake", "stop_branch_waiter"].map(waiterBlock).join("\n");
const runBlocks = (s, code, extraEnv = {}) =>
  spawnSync("bash", ["-c", `${allBlocks()}\n${code}`, REPO, s.branch], { cwd: s.seat, env: { ...s.env, ...extraEnv }, encoding: "utf8", timeout: LONG });

test("a first arm and record over links in .catalyst write the checkout's own files and nothing outside", () => {
  const s = makeSeat();
  try {
    const out = outsideDir(s);
    const log = plant(s, out, logNameOf(s.branch), "outside log\n");
    const state = plantDir(s, out, "branch-waiter.json");
    const end = plantDir(s, out, "create-pr-end.json");
    const r = record(s);
    expect(r.stdout).toMatch(/^OWNED: /);
    expect(readFileSync(log, "utf8")).toBe("outside log\n");
    expect(readdirSync(state)).toEqual(["canary"]);
    expect(readdirSync(end)).toEqual(["canary"]);
    expect(plainFile(waiterLog(s))).toBe(true);
    expect(plainFile(join(s.seat, ".catalyst/branch-waiter.json"))).toBe(true);
    expect(plainFile(join(s.seat, ".catalyst/create-pr-end.json"))).toBe(true);
    expect(savedEntry(s)).toMatchObject({ pr: 77, ticket: "ENG-123", cursor: 100 });
    // The record stores "waiter" with its reader; "owned" is only what check prints.
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "waiter", ticket: "ENG-123" });
    expect(endRecord(s).owner.pid).toBe(process.pid);
    expect(check(s).stdout).toMatch(/^OWNED: /);
    expect(readdirSync(out).sort()).toEqual([`canary-${logNameOf(s.branch)}`, "dir-branch-waiter.json", "dir-create-pr-end.json"].sort());
  } finally {
    cleanup(s);
  }
}, LONG);

test("a .catalyst that is a link out of the checkout gets no waiter and no record, and nothing is written there", () => {
  const s = makeSeat();
  try {
    const out = outsideDir(s);
    writeFileSync(join(out, "canary"), "untouched\n");
    symlinkSync(out, join(s.seat, ".catalyst"));
    expect(readFileSync(join(s.seat, ".catalyst/canary"), "utf8")).toBe("untouched\n");
    const r = record(s);
    expect(r.stdout).not.toContain("OWNED");
    expect(waitPids(s.ref)).toEqual([]);
    expect(readdirSync(out)).toEqual(["canary"]);
    expect(readFileSync(join(out, "canary"), "utf8")).toBe("untouched\n");
    const a = armIn(s, s.seat);
    expect(a.stderr).toContain("is not this checkout's own directory (a link out of the checkout");
    expect(readdirSync(out)).toEqual(["canary"]);
    // CONTROL: the same checkout with its own .catalyst arms.
    rmSync(join(s.seat, ".catalyst"));
    expect(record(s).stdout).toMatch(/^OWNED: /);
  } finally {
    cleanup(s);
  }
}, LONG);

// A waiter file the repository tracks is repository content. A committed cursor far ahead would make the
// wait skip every real event, so the arm refuses it. CONTROLS: a tracked .catalyst/catalyst.toml alone arms,
// and the same state file, untracked, is read as the waiter's own and arms after its cursor.
test("a waiter state the repository tracks is not read as the waiter's own, and the same file untracked is", () => {
  const s = makeSeat();
  try {
    mkdirSync(join(s.seat, ".catalyst"), { recursive: true });
    writeFileSync(join(s.seat, ".catalyst/catalyst.toml"), '[linear]\nteam = "ENG"\n');
    expect(s.git("add", ".catalyst/catalyst.toml").status).toBe(0);
    expect(s.git("commit", "-q", "-m", "config").status).toBe(0);
    expect(armIn(s, s.seat).stdout).toContain("branch-waiter: armed ");
    stopWaits(s.ref);
    const state = join(s.seat, ".catalyst/branch-waiter.json");
    writeFileSync(state, `${JSON.stringify({ [s.ref]: { pr: 77, ticket: "ENG-123", cursor: 999999 } })}\n`);
    expect(s.git("add", "-f", ".catalyst/branch-waiter.json").status).toBe(0);
    expect(s.git("commit", "-q", "-m", "state").status).toBe(0);
    writeFileSync(s.calls, "");
    const tracked = armIn(s, s.seat);
    expect(tracked.stderr).toContain("a waiter file the repository tracks");
    expect(tracked.stdout).not.toContain("branch-waiter: armed ");
    expect(waitPids(s.ref)).toEqual([]);
    expect(s.git("diff", "--quiet", "HEAD", "--", ".catalyst/branch-waiter.json").status).toBe(0);
    expect(callLines(s).some((l) => l.startsWith("catalyst events wait-for "))).toBe(false);
    expect(s.git("rm", "-q", "--cached", ".catalyst/branch-waiter.json").status).toBe(0);
    expect(armIn(s, s.seat).stdout).toContain("branch-waiter: armed ");
    expect(waitTimeouts(s)).toHaveLength(1);
    expect(callLines(s).some((l) => l.includes("--after 999999 "))).toBe(true);
  } finally {
    cleanup(s);
  }
}, LONG);

test("a wake log that is a link is replaced and never read: the handler arms from the saved cursor and keeps the pending retry", () => {
  const s = makeSeat();
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    const saved = pendIn(s, 30);
    const out = outsideDir(s);
    // The handler reads the wake from the log it is given; here that name is a link.
    const log = plant(s, out, logNameOf(s.branch), "cursor 155\nwaiter-rc 124\n");
    const h = runBlocks(s, `handle_waiter_wake "$0" "$1" ".catalyst/$(_bw_log_name "$0" "$1")"`);
    expect(h.stdout).toContain("branch-waiter: armed ");
    expect(readFileSync(log, "utf8")).toBe("cursor 155\nwaiter-rc 124\n");
    expect(plainFile(waiterLog(s))).toBe(true);
    // The sequence in the file outside is not taken: the wait resumes from the one the state saved.
    expect(savedEntry(s)).toMatchObject({ pr: 77, ticket: "ENG-123", cursor: 100, pending: 1, due: saved.due });
    const [secs] = waitTimeouts(s);
    expect(secs).toBeLessThanOrEqual(30);
    expect(callLines(s).some((l) => l.includes("--after 155 "))).toBe(false);
    expect(callLines(s).some((l) => l.includes("--after 100 "))).toBe(true);
    expect(check(s).stdout).toMatch(/^OWNED: /);
    // CONTROL: the same wake in the checkout's own log is read, and the wait resumes from it.
    stopWaits(s.ref);
    writeFileSync(waiterLog(s), "cursor 155\nwaiter-rc 124\n");
    writeFileSync(s.calls, "");
    expect(runBlocks(s, `handle_waiter_wake "$0" "$1" ".catalyst/$(_bw_log_name "$0" "$1")"`).stdout).toContain("branch-waiter: armed ");
    waitTimeouts(s);
    expect(callLines(s).some((l) => l.includes("--after 155 "))).toBe(true);
    expect(savedEntry(s)).toMatchObject({ cursor: 155, pending: 1, due: saved.due });
  } finally {
    cleanup(s);
  }
}, LONG);

// The wait never reads its log by name: it tells a timeout from a failure by the CLI's own output. This case
// ends on an event and measures the writes alone; the timeout case is further down.
test("a wait keeps writing the log it was started with when the name is moved and replaced by a link", () => {
  const s = makeSeat();
  const event = JSON.stringify({ sequence: 101, type: "comms.message.posted", entity: { type: "ticket", id: "ENG-123" }, payload: { repo: REPO, pr: 77, ticket: "ENG-123" } });
  try {
    const hold = join(s.dir, "release");
    expect(record(s, 77, "ENG-123", { WAIT_SLEEP: "0", WAIT_HOLD: hold, WAIT_EVENT: event }).stdout).toMatch(/^OWNED: /);
    const out = outsideDir(s);
    renameSync(waiterLog(s), `${waiterLog(s)}.moved`);
    const canary = plant(s, out, logNameOf(s.branch), "outside log\n");
    writeFileSync(hold, "");
    for (let i = 0; i < 150 && !/^waiter-rc /m.test(readFileSync(`${waiterLog(s)}.moved`, "utf8")); i++) spawnSync("sleep", ["0.1"]);
    expect(readFileSync(`${waiterLog(s)}.moved`, "utf8")).toBe(`${armLine(s.branch)}${event}\ncursor 101\nwaiter-rc 0\n`);
    expect(readFileSync(canary, "utf8")).toBe("outside log\n");
  } finally {
    cleanup(s);
  }
}, LONG);

test("stop over links in .catalyst removes the checkout's own names and changes nothing outside", () => {
  const s = makeSeat();
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    const out = outsideDir(s);
    const log = plant(s, out, logNameOf(s.branch), "outside log\n");
    const st = runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
    expect(st.stdout).toContain("branch-waiter: stopped the waiter on ");
    expect(named(waiterLog(s))).toBe(false);
    expect(readFileSync(log, "utf8")).toBe("outside log\n");
    expect(plainFile(join(s.seat, ".catalyst/branch-waiter.json"))).toBe(true);
    expect(savedEntry(s)).toBeUndefined();
    // A state name that is a link reads as no state: stop writes nothing through it.
    expect(record(s).stdout).toMatch(/^OWNED: /);
    const state = plant(s, out, "branch-waiter.json", '{"outside": 1}\n');
    runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
    expect(readFileSync(state, "utf8")).toBe('{"outside": 1}\n');
    expect(lstatSync(join(s.seat, ".catalyst/branch-waiter.json")).isSymbolicLink()).toBe(true);
  } finally {
    cleanup(s);
  }
}, LONG);

// The wake handler and stop use the helpers and the arm function that the arm block defines. Run alone,
// each does nothing and names the arm block, so a wait is never killed with its log and state left behind.
// CONTROL: with the arm block defined first, stop stops the same wait.
test("the wake handler and stop run without the arm block do nothing and say to define it first", () => {
  const s = makeSeat();
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    const state = join(s.seat, ".catalyst/branch-waiter.json");
    const before = readFileSync(state, "utf8");
    const alone = (fn, code, extraEnv = {}) =>
      spawnSync("bash", ["-c", `${waiterBlock(fn)}\n${code}`, REPO, s.branch], { cwd: s.seat, env: { ...s.env, ...extraEnv }, encoding: "utf8", timeout: LONG });
    const wake = join(s.dir, "wake.log");
    writeFileSync(wake, "cursor 150\nwaiter-rc 124\n");
    const h = alone("handle_waiter_wake", `handle_waiter_wake "$0" "$1" "${wake}"`);
    expect(h.stderr).toContain("define the arm block above first");
    const st = alone("stop_branch_waiter", `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
    expect(st.stderr).toContain("define the arm block above first");
    expect(st.stdout).not.toContain("stopped the waiter");
    expect(waitPids(s.ref).length).toBeGreaterThan(0);
    expect(plainFile(waiterLog(s))).toBe(true);
    expect(readFileSync(state, "utf8")).toBe(before);
    expect(runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" }).stdout).toContain("branch-waiter: stopped the waiter on ");
    for (let i = 0; i < 50 && waitPids(s.ref).length > 0; i++) spawnSync("sleep", ["0.1"]);
    expect(waitPids(s.ref)).toEqual([]);
  } finally {
    cleanup(s);
  }
}, LONG);

// The liveness check sees every checkout of the machine and the wake goes to the log of the one
// that armed the wait, so a reader here reads nothing of a wait armed elsewhere.
test("a wait that another checkout started does not own this one's pull request, for check and for record", () => {
  const s = makeSeat();
  const other = join(s.dir, "other");
  initCheckout(s, other);
  try {
    // The wait holds until this test releases it, so the control below runs while it is alive.
    const hold = join(s.dir, "release");
    expect(record(s, 77, "ENG-123", { WAIT_SLEEP: "0", WAIT_HOLD: hold }).stdout).toMatch(/^OWNED: /);
    // CONTROL: while its own wait runs, the check passes.
    expect(check(s).status).toBe(0);
    writeFileSync(hold, "");
    expect(waitEnded(s)).toBe(true);
    expect(armIn(s, other).stdout).toContain("branch-waiter: armed ");
    expect(waitPids(s.ref).length).toBeGreaterThan(0);
    // The reader on record is this process, which is alive.
    expect(endRecord(s)).toMatchObject({ end: "waiter", owner: { pid: process.pid } });
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/^NEEDS ATTENTION: a wait is running on .*, but it was not started in this checkout/);
    const again = record(s);
    expect(again.stdout).toMatch(/^NEEDS ATTENTION: .* was not started in this checkout/);
    expect(endRecord(s).end).toBe("needs-attention");
  } finally {
    cleanup(s);
  }
}, LONG);

// A wait that is killed writes no exit line, so its log alone looks like the log of a running one.
test("a killed wait's log does not make another checkout's wait this one's, and a new arm here does", () => {
  const s = makeSeat();
  const other = join(s.dir, "other");
  initCheckout(s, other);
  const kill = () => {
    stopWaits(s.ref);
    expect(waitPids(s.ref)).toEqual([]);
  };
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    kill();
    expect(readFileSync(waiterLog(s), "utf8")).not.toContain("waiter-rc");
    // At once, so the stale log and the other checkout's wait start within the same second.
    expect(armIn(s, other).stdout).toContain("branch-waiter: armed ");
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/^NEEDS ATTENTION: a wait is running on .*, but it was not started in this checkout/);
    // CONTROL: the same empty log, with a wait this checkout armed.
    kill();
    expect(armIn(s, s.seat).stdout).toContain("branch-waiter: armed ");
    const mine = check(s);
    expect(mine.status).toBe(0);
    expect(mine.stdout).toMatch(/^OWNED: /);
  } finally {
    cleanup(s);
  }
}, LONG);

// Two branch names that keep the same characters once shared one log, and a newer wait on the second emptied
// the log the first branch's reader would read. Each has its own log now; the wait another checkout runs is
// still not this one's.
test("a log that another branch's wait wrote here does not make another checkout's wait this one's", () => {
  const s = makeSeat({ branch: `${freshBranch()}/api` });
  const twin = s.branch.replace("/", "-");
  const other = join(s.dir, "other");
  initCheckout(s, other);
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    expect(armIn(s, other).stdout).toContain("branch-waiter: armed ");
    expect(armIn(s, s.seat, twin).stdout).toContain("branch-waiter: armed ");
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/^NEEDS ATTENTION: a wait is running on .*, but it was not started in this checkout/);
    expect(record(s).stdout).toMatch(/^NEEDS ATTENTION: .* was not started in this checkout/);
  } finally {
    stopWaits(refOf(twin));
    cleanup(s);
  }
}, LONG);

// A process's directory comes from /proc on Linux and from lsof elsewhere. These stubs take over
// both, so the second path and the unreadable case do not depend on the machine the test runs on.
test("the wait's directory decides, from lsof as well as from /proc, and an unreadable one is not here", () => {
  const s = makeSeat();
  const stub = join(s.dir, "stub");
  mkdirSync(stub);
  const tool = (name, body) => writeFileSync(join(stub, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  const PATH = `${stub}:${s.env.PATH}`;
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    // CONTROL: the machine's own source of the directory.
    expect(check(s).status).toBe(0);
    tool("readlink", "exit 1");
    // The directory reaches the stub as a value, so a quote in its name is still one path.
    tool("lsof", 'test -d "$LSOF_CWD" || exit 1; echo fcwd; (stat -c "D%d i%i" "$LSOF_CWD" 2>/dev/null || stat -f "D%d i%i" "$LSOF_CWD") | tr " " "\\n"');
    expect(check(s, 77, { PATH, LSOF_CWD: realpathSync(s.seat) }).status).toBe(0);
    expect(check(s, 77, { PATH, LSOF_CWD: join(s.dir, "elsewhere") }).stderr).toContain("was not started in this checkout");
    tool("lsof", "exit 1");
    const unread = check(s, 77, { PATH });
    expect(unread.status).toBe(9);
    expect(unread.stderr).toContain("was not started in this checkout");
  } finally {
    cleanup(s);
  }
}, LONG);

// A wait is started in the background, so its command line can be missing from the process table for a
// moment. The stub hides it from the first reads, and then for good.
test("a wait that shows late in the process table is owned, and one that never shows is not called ended", () => {
  const s = makeSeat();
  const real = spawnSync("bash", ["-c", "command -v pgrep"], { env: s.env, encoding: "utf8" }).stdout.trim();
  expect(real).toMatch(/^\//);
  const stub = join(s.dir, "stub");
  mkdirSync(stub);
  const count = join(s.dir, "count");
  const PATH = `${stub}:${s.env.PATH}`;
  // The paths reach the stub as values, so a directory name with a quote in it is still one path.
  const env = { PATH, PGREP_COUNT: count, PGREP_REAL: real };
  const hideFirst = (n) => writeFileSync(join(stub, "pgrep"), `#!/bin/bash\nn=$(($(cat "$PGREP_COUNT" 2>/dev/null || echo 0) + 1)); echo "$n" > "$PGREP_COUNT"\n[ "$n" -gt ${n} ] || exit 1\nexec "$PGREP_REAL" "$@"\n`, { mode: 0o755 });
  try {
    // The first call is the arm's own, and the next three are the record's.
    hideFirst(4);
    expect(record(s, 77, "ENG-123", env).stdout).toMatch(/^OWNED: /);
    expect(check(s).status).toBe(0);
    expect(Number(readFileSync(count, "utf8"))).toBeGreaterThan(4);
    stopWaits(s.ref);
    hideFirst(100000);
    const never = record(s, 77, "ENG-123", env);
    expect(never.stdout).toMatch(/^NEEDS ATTENTION: /);
    expect(endRecord(s).reason).toContain("no process of it shows yet");
    expect(endRecord(s).reason).not.toContain("ended at once");
  } finally {
    cleanup(s);
  }
}, LONG);

// A command with no agent session above it names no reader. It must not take the wait from a live one.
test("record from a command with no agent session keeps the live reader on record, and not a dead one", () => {
  const s = makeSeat();
  const gonePid = startOwner();
  const owner = startOwner();
  try {
    expect(endOwner(gonePid)).toBe(true);
    const none = { PR_END_STATE_OWNER_PID: String(gonePid) };
    expect(record(s, 77, "ENG-123", { PR_END_STATE_OWNER_PID: String(owner) }).stdout).toMatch(/^OWNED: /);
    const again = record(s, 77, "ENG-123", none);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/^OWNED: .*the reader on record was kept/);
    expect(endRecord(s).owner.pid).toBe(owner);
    expect(check(s).status).toBe(0);
    // CONTROL: the same command once that reader has ended.
    expect(endOwner(owner)).toBe(true);
    const dead = record(s, 77, "ENG-123", none);
    expect(dead.stdout).toMatch(/^NEEDS ATTENTION: /);
    expect(endRecord(s).end).toBe("needs-attention");
  } finally {
    endOwner(owner);
    cleanup(s);
  }
}, LONG);

// The wait's number in the waiter state is written before its process starts, and a probe comes after.
// The stub rewrites it to another pull request on the given call of the process listing.
test("an arm for another pull request between the probes is not credited to this one, for check and for record", () => {
  const s = makeSeat();
  const real = spawnSync("bash", ["-c", "command -v pgrep"], { env: s.env, encoding: "utf8" }).stdout.trim();
  expect(real).toMatch(/^\//);
  const stub = join(s.dir, "stub");
  mkdirSync(stub);
  const count = join(s.dir, "count");
  const state = join(s.seat, ".catalyst/branch-waiter.json");
  // The paths and the ref reach the stub as values, so a quote in a directory name is still one path.
  const env = { PATH: `${stub}:${s.env.PATH}`, PGREP_COUNT: count, PGREP_REAL: real, PGREP_STATE: state, PGREP_REF: s.ref };
  const rewriteAt = (n) => {
    rmSync(count, { force: true });
    writeFileSync(join(stub, "pgrep"), `#!/bin/bash
n=$(($(cat "$PGREP_COUNT" 2>/dev/null || echo 0) + 1)); echo "$n" > "$PGREP_COUNT"
if [ "$n" = ${n} ]; then jq --arg ref "$PGREP_REF" '.[$ref].pr = 78' "$PGREP_STATE" > "$PGREP_STATE.x" && mv "$PGREP_STATE.x" "$PGREP_STATE"; fi
exec "$PGREP_REAL" "$@"
`, { mode: 0o755 });
  };
  const back = () => writeFileSync(state, readFileSync(state, "utf8").replace('"pr": 78', '"pr": 77').replace('"pr":78', '"pr":77'));
  const last = () => Number(readFileSync(count, "utf8"));
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    // CONTROL: the same stub with no rewrite.
    rewriteAt(100000);
    expect(check(s, 77, env).status).toBe(0);
    const probes = last();
    expect(record(s, 77, "ENG-123", env).stdout).toMatch(/^OWNED: /);
    // The last probe of check is its second, and the pull request number was read before it.
    rewriteAt(2);
    const c = check(s, 77, env);
    expect(last()).toBe(probes);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/^NEEDS ATTENTION: .*was armed for pull request #78\.$/m);
    back();
    // record probes five times: the two guards, the arm's own check, the read after the arm, and the
    // checkout's probe. The first read of the armed pull request follows the fourth, so a rewrite at the
    // fifth is seen only by the second read.
    rewriteAt(5);
    const again = record(s, 77, "ENG-123", env);
    expect(last()).toBe(5);
    expect(again.stdout).toMatch(/^NEEDS ATTENTION: .*was armed for pull request #78, not #77/);
    expect(endRecord(s).end).toBe("needs-attention");
  } finally {
    cleanup(s);
  }
}, LONG);

// The wake table says a wait the cloud refused (3), or that failed (1, 2), is reported and not armed
// again. An arm would empty the log that says why.
test("a wait that failed or was refused is not armed again for the same pull request, and its log is kept", () => {
  const s = makeSeat();
  const waits = () => readFileSync(s.calls, "utf8").split("\n").filter((l) => l.startsWith("catalyst events wait-for")).length;
  try {
    record(s, 77, "ENG-123", { WAIT_SLEEP: "0", WAIT_EXIT: "3" });
    expect(waitEnded(s)).toBe(true);
    expect(waits()).toBe(1);
    const kept = readFileSync(waiterLog(s), "utf8");
    expect(kept).toContain("waiter-rc 3");
    const again = record(s);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/^NEEDS ATTENTION: .*failed \(waiter-rc 3\): events: the filter was refused\. It is not armed again/);
    expect(readFileSync(waiterLog(s), "utf8")).toBe(kept);
    expect(waits()).toBe(1);
    expect(check(s).stderr).toMatch(/is not running \(waiter-rc 3\)\. Stop and report it, as the waiter reference says; it is not armed again\.$/m);
    for (const rc of ["1", "2"]) {
      writeFileSync(waiterLog(s), `it broke\nwaiter-rc ${rc}\n`);
      expect(record(s).stdout).toMatch(new RegExp(`^NEEDS ATTENTION: .*failed \\(waiter-rc ${rc}\\): it broke`));
      expect(readFileSync(waiterLog(s), "utf8")).toContain(`waiter-rc ${rc}`);
    }
    expect(waits()).toBe(1);
    // The reason names the published arm, which is the deliberate way back: a record alone never takes it.
    expect(record(s).stdout).toContain("arm_branch_waiter from ");
    expect(armIn(s, s.seat).stdout).toContain("branch-waiter: armed ");
    expect(record(s).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    // CONTROL: the log of a wait that ran out, one that was stopped, and another pull request of the branch.
    // The wait that ran out reached 105 while the state saved 100. record is not the wake handler: it arms
    // from the saved sequence, so the events between are read again and none is skipped.
    writeFileSync(waiterLog(s), "cursor 105\nwaiter-rc 124\n");
    writeFileSync(s.calls, "");
    expect(savedEntry(s).cursor).toBe(100);
    expect(record(s).stdout).toMatch(/^OWNED: /);
    expect(waitTimeouts(s)).toHaveLength(1);
    expect(callLines(s).some((l) => l.includes("--after 100 "))).toBe(true);
    expect(callLines(s).some((l) => l.includes("--after 105 "))).toBe(false);
    stopWaits(s.ref);
    writeFileSync(waiterLog(s), "cursor 100\nwaiter-rc 143\n");
    expect(check(s).stderr).toMatch(/is not running \(waiter-rc 143\)\. The wait was stopped before it ended; arm it again with record\./);
    expect(record(s).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    // A killed wait wrote no exit line: no wake to handle, and record arms from the saved sequence.
    writeFileSync(waiterLog(s), "");
    expect(check(s).stderr).toMatch(/is not running\. Arm it again with record\.$/m);
    expect(record(s).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    writeFileSync(waiterLog(s), "it broke\nwaiter-rc 3\n");
    expect(record(s, 78).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    writeFileSync(waiterLog(s), "it broke\nwaiter-rc 3\n");
    expect(record(s, 78).stdout).toMatch(/^NEEDS ATTENTION: /);
    // The log's exit is #78's now. check gives it to #78 alone: #77 is told to arm again, not to stop.
    expect(check(s, 78).stderr).toMatch(/\(waiter-rc 3\)\. Stop and report it/);
    const first = check(s, 77);
    expect(first.status).toBe(9);
    expect(first.stderr).not.toContain("waiter-rc 3");
    expect(first.stderr).toMatch(/is not running\. Arm it again with record\.$/m);
  } finally {
    cleanup(s);
  }
}, LONG);

// A wake is written to the log and nowhere else here. The wake handler copies the sequence the wait
// reached into the waiter state before it arms again, so a state behind the log is a wake nobody read.
test("a wake that nothing handled is not armed over, its log is kept, and the published handler is the way back", () => {
  const s = makeSeat();
  const event = JSON.stringify({ sequence: 101, type: "comms.message.posted", entity: { type: "ticket", id: "ENG-123" }, payload: { repo: REPO, pr: 77, ticket: "ENG-123" } });
  const waits = () => callLines(s).filter((l) => l.startsWith("catalyst events wait-for"));
  const stateFile = join(s.seat, ".catalyst/branch-waiter.json");
  const state = () => JSON.parse(readFileSync(stateFile, "utf8"))[s.ref];
  try {
    record(s, 77, "ENG-123", { WAIT_SLEEP: "0", WAIT_EVENT: event });
    expect(waitEnded(s)).toBe(true);
    const kept = readFileSync(waiterLog(s), "utf8");
    expect(kept).toBe(`${armLine(s.branch)}${event}\ncursor 101\nwaiter-rc 0\n`);
    expect(state().cursor).toBe(100);
    const again = record(s);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/^NEEDS ATTENTION: .*woke \(waiter-rc 0\) and nothing has handled its wake\. It is not armed again/);
    expect(again.stdout).toContain("handle_waiter_wake from ");
    expect(readFileSync(waiterLog(s), "utf8")).toBe(kept);
    expect(waits().length).toBe(1);
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/is not running \(waiter-rc 0\)\. Handle its wake with handle_waiter_wake first/);
    // The published handler reads the wake, moves the state to the sequence it reached, and arms again.
    const handler = `${waiterBlock("arm_branch_waiter")}\n${waiterBlock("handle_waiter_wake")}\nhandle_waiter_wake "$0" "$1" "$2"`;
    const h = spawnSync("bash", ["-c", handler, REPO, s.branch, `.catalyst/${logNameOf(s.branch)}`], { cwd: s.seat, env: s.env, encoding: "utf8", timeout: LONG });
    expect(h.stdout).toContain("branch-waiter: message for ENG-123");
    expect(h.stdout).toContain("branch-waiter: armed ");
    expect(state().cursor).toBe(101);
    // The wait's shell shows in the process table before the stand-in under it writes its call, so wait for the call.
    for (let i = 0; i < 50 && waits().length < 2; i++) spawnSync("sleep", ["0.1"]);
    expect(waits()).toHaveLength(2);
    expect(waits().at(-1)).toBe("catalyst events wait-for --ticket ENG-123 --after 101 --timeout 60");
    expect(record(s).stdout).toMatch(/^OWNED: .*The wait was already running/);
    stopWaits(s.ref);
    // CONTROL: a handled wake whose next wait never started. The state holds the logged sequence.
    writeFileSync(waiterLog(s), kept);
    expect(check(s).stderr).toMatch(/is not running \(waiter-rc 0\)\. Its wake was handled; arm it again with record\.$/m);
    expect(record(s).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    // CONTROL: another pull request of the branch. The arm drops another pull request's wake, as before.
    writeFileSync(stateFile, JSON.stringify({ [s.ref]: { pr: 77, ticket: "ENG-123", cursor: 100 } }));
    writeFileSync(waiterLog(s), kept);
    expect(record(s, 78).stdout).toMatch(/^OWNED: /);
  } finally {
    cleanup(s);
  }
}, LONG);

// The script is on no PATH. Each command the reference publishes and each one check prints is run as it is.
test("the published handoff command and the commands check prints run as they are", () => {
  const push = readFileSync(join(skillDir, "references/push-and-create.md"), "utf8");
  const found = [...push.matchAll(/`(bash "\$\{CLAUDE_SKILL_DIR\}\/scripts\/pr-end-state\.sh" handoff [^`]+)`/g)].map((m) => m[1]);
  expect(found.length).toBe(1);
  // A branch name with characters the shell reads, so a printed command that does not quote it fails.
  const s = makeSeat({ branch: `${freshBranch()}(qa)` });
  const values = { "<owner/name>": REPO, "<branch>": s.branch, "<pr>": "77", "<ticket:KEY-123 or session:id>": "ticket:ENG-123", "<message id>": "msg_01", "<next-turn or next-phase>": "next-turn" };
  const command = found[0].replace(/<[^>]+>/g, (p) => values[p] ?? p);
  expect(command).not.toContain("<");
  // The printed command ends with TICKET, which the reader replaces with the ticket key.
  const runPrinted = (stderr) => {
    const line = stderr.match(/in place of TICKET: (.*)$/m)[1];
    expect(line).toMatch(/ TICKET$/);
    return spawnSync("bash", ["-c", line.replace(/ TICKET$/, " ENG-123")], { cwd: s.seat, env: s.env, encoding: "utf8", timeout: LONG });
  };
  try {
    // Nothing is on record: check names the record command, and it works as printed.
    const run1 = runPrinted(check(s).stderr);
    expect(run1.stderr).toBe("");
    expect(run1.stdout).toMatch(/^OWNED: /);
    expect(check(s).status).toBe(0);
    // A wait with no reader on record: check names the same command, and it works as printed.
    stopWaits(s.ref);
    rmSync(join(s.seat, ".catalyst/create-pr-end.json"));
    expect(armIn(s, s.seat).stdout).toContain("branch-waiter: armed ");
    const noReader = check(s);
    expect(noReader.stderr).toContain("no agent session is on record as its reader");
    const run2 = runPrinted(noReader.stderr);
    expect(run2.stderr).toBe("");
    expect(run2.stdout).toMatch(/^OWNED: .*The wait was already running/);
    // The published handoff command, with the same branch name.
    const h = spawnSync("bash", ["-c", command], { cwd: s.seat, env: published(s), encoding: "utf8", timeout: LONG });
    expect(h.stderr).toBe("");
    expect(h.stdout).toMatch(/^HANDED-OFF: pull request #77 \(open\) was sent to ticket:ENG-123 \(message msg_01, next-turn\)\.$/m);
    expect(check(s).stdout).toMatch(/^HANDED-OFF: /);
  } finally {
    cleanup(s);
  }
}, LONG);

// A move onto a directory puts the file inside it and succeeds.
test("a directory at the record's path is a write failure, for handoff and for record", () => {
  const s = makeSeat();
  try {
    mkdirSync(join(s.seat, ".catalyst/create-pr-end.json"), { recursive: true });
    const h = handoff(s, "ticket:ENG-123", "msg-1", "next-turn");
    expect(h.status).toBe(9);
    expect(h.stdout).not.toContain("HANDED-OFF");
    expect(h.stderr).toContain("could not write .catalyst/create-pr-end.json");
    const r = record(s);
    expect(r.status).toBe(9);
    expect(r.stdout).not.toContain("OWNED");
    expect(readdirSync(join(s.seat, ".catalyst/create-pr-end.json"))).toEqual([]);
  } finally {
    cleanup(s);
  }
}, LONG);

// The wake handler arms again in the same checkout without a new record, and the new wait writes
// the log the reader on record reads.
test("a wait armed again in the same checkout keeps its reader, and a running wait with no log here does not", () => {
  const s = makeSeat();
  try {
    const hold = join(s.dir, "release");
    expect(record(s, 77, "ENG-123", { WAIT_SLEEP: "0", WAIT_HOLD: hold }).stdout).toMatch(/^OWNED: /);
    writeFileSync(hold, "");
    expect(waitEnded(s)).toBe(true);
    expect(check(s).status).toBe(9);
    expect(armIn(s, s.seat).stdout).toContain("branch-waiter: armed ");
    const c = check(s);
    expect(c.status).toBe(0);
    expect(c.stdout).toMatch(/^OWNED: /);
    // A log that shows an exit belongs to a wait that is over, whichever wait runs.
    writeFileSync(waiterLog(s), "waiter-rc 1\n");
    const over = check(s);
    expect(over.status).toBe(9);
    expect(over.stderr).toContain("was not started in this checkout");
    rmSync(waiterLog(s));
    expect(waitPids(s.ref).length).toBeGreaterThan(0);
    const bare = check(s);
    expect(bare.status).toBe(9);
    expect(bare.stderr).toContain("was not started in this checkout");
  } finally {
    cleanup(s);
  }
}, LONG);

test("usage: an unknown command, a repository without an owner and a pull request that is not a number are refused", () => {
  const s = makeSeat();
  try {
    expect(run(s, ["arm", REPO, s.branch, "77"]).status).toBe(2);
    expect(run(s, ["record", "example", s.branch, "77"]).status).toBe(2);
    expect(run(s, ["check", REPO, s.branch, "seventy"]).status).toBe(2);
    expect(run(s, ["check", REPO, s.branch]).status).toBe(2);
    expect(handoff(s, "ticket:ENG-123", "msg_01", "next-turn", "extra").status).toBe(2);
    expect(hasEndFile(s)).toBe(false);
    expect(callLines(s)).toEqual([]);
  } finally {
    cleanup(s);
  }
}, LONG);

test("the create step as published leaves an owner on record, so a run that stops right after it is not silent", () => {
  const block = createBlock();
  const s = makeSeat();
  try {
    const r = runBlock(s, block);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("77\n");
    expect(r.stdout).toMatch(/^OWNED: a waiter is running on /m);
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "waiter" });
    expect(waitPids(s.ref).length).toBeGreaterThan(0);
    expect(callLines(s).some((l) => l.startsWith("gh pr create "))).toBe(true);
  } finally {
    cleanup(s);
  }
}, LONG);

// CONTROL: the test above creates the pull request with the same block when the lookup answers.
test("the create step creates nothing when the repository lookup fails", () => {
  const block = createBlock();
  const s = makeSeat();
  try {
    s.env.REPO_FAIL = "1";
    const r = runBlock(s, block);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no pull request was created");
    expect(callLines(s)).toContain("gh repo view --json nameWithOwner -q .nameWithOwner");
    expect(callLines(s).filter((l) => l.startsWith("gh pr create "))).toEqual([]);
    expect(hasEndFile(s)).toBe(false);
  } finally {
    cleanup(s);
  }
}, LONG);

// CONTROL for the control above, and the state a session left behind when it opened a pull
// request and stopped: the same block without its record call leaves nothing, and the check,
// run by anyone afterwards, says so.
test("the create step without its record call leaves an open pull request that the check reports as NEEDS ATTENTION", () => {
  const block = createBlock();
  const cut = block.indexOf(RECORD_MARK);
  expect(cut).toBeGreaterThan(block.indexOf("gh pr create --title"));
  const s = makeSeat();
  try {
    const r = runBlock(s, block.slice(0, cut));
    expect(r.status).toBe(0);
    expect(callLines(s).some((l) => l.startsWith("gh pr create "))).toBe(true);
    expect(hasEndFile(s)).toBe(false);
    expect(waitPids(s.ref)).toEqual([]);
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/^NEEDS ATTENTION: /);
  } finally {
    cleanup(s);
  }
}, LONG);

test("the skill's text sends every run through the record and the check", () => {
  const block = createBlock();
  expect(block.indexOf('scripts/pr-end-state.sh" record')).toBeGreaterThan(block.indexOf("gh pr create --title"));
  const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  expect(skill).toContain("scripts/pr-end-state.sh record");
  expect(skill).toContain('scripts/pr-end-state.sh" check');
  expect(skill).toContain("NEEDS ATTENTION");
  const outcomes = readFileSync(join(skillDir, "references/outcomes-and-errors.md"), "utf8");
  expect(outcomes).toContain('scripts/pr-end-state.sh" check');
  expect(outcomes).toContain("A reason is not an owner");
  expect(outcomes).toContain("a wait Step 9 started keeps running");
  expect(outcomes).toContain("run `handoff` with them again once the pull request can be read");
  const push = readFileSync(join(skillDir, "references/push-and-create.md"), "utf8");
  expect(push).toContain("continue at Step 10 with that number. Do not run `gh pr create` again");
  const preflight = readFileSync(join(skillDir, "references/preflight.md"), "utf8");
  expect(preflight).toContain('scripts/pr-end-state.sh" record');
  expect(preflight).toContain('scripts/pr-end-state.sh" check');
});


// The command works on the checkout it runs in. Outside one there is no root to work from, and no
// listing of tracked files to trust, so it refuses and writes nothing.
test("record, handoff and check run outside a git checkout refuse and write nothing", () => {
  const s = makeSeat();
  try {
    const plain = join(s.dir, "plain");
    mkdirSync(plain);
    const env = { ...s.env, GIT_CEILING_DIRECTORIES: s.dir };
    for (const args of [["record", REPO, s.branch, "77", "ENG-123"], ["handoff", REPO, s.branch, "77", "ticket:ENG-9", "m-1", "next-turn"], ["check", REPO, s.branch, "77"]]) {
      const r = spawnSync("bash", [script, ...args], { cwd: plain, env, encoding: "utf8", timeout: LONG });
      expect(r.status).toBe(9);
      expect(r.stderr).toContain("not in a git checkout");
    }
    expect(named(join(plain, ".catalyst"))).toBe(false);
    expect(waitPids(s.ref)).toHaveLength(0);
    // CONTROL: the same handoff from inside the checkout records it.
    expect(handoff(s, "ticket:ENG-9", "m-1", "next-turn").stdout).toMatch(/^HANDED-OFF: /);
  } finally {
    cleanup(s);
  }
}, LONG);

// A listing of tracked waiter files that fails says nothing about what is tracked, so it is a refusal.
test("a waiter-file listing that fails is a refusal: an unreadable index gets no wait and no record, and nor does a plain directory", () => {
  const s = makeSeat();
  try {
    writeFileSync(join(s.seat, ".git/index"), "not an index\n");
    // CONTROL: the listing does fail on this index.
    expect(spawnSync("git", ["ls-files"], { cwd: s.seat, env: s.env, encoding: "utf8" }).status).not.toBe(0);
    const r = record(s);
    expect(r.status).toBe(9);
    expect(r.stderr).toContain("nothing was recorded");
    expect(hasEndFile(s)).toBe(false);
    expect(waitPids(s.ref)).toHaveLength(0);
    const plain = join(s.dir, "plain");
    mkdirSync(plain);
    const a = armIn(s, plain, s.branch, "ENG-123", { GIT_CEILING_DIRECTORIES: s.dir });
    expect(a.stderr).toContain(".catalyst is not this checkout's own directory");
    expect(waitPids(s.ref)).toHaveLength(0);
  } finally {
    cleanup(s);
  }
}, LONG);

// The reference the arm block is loaded from is the one shipped beside the script. A skill directory left in
// the environment, relative or absolute, is not where it is read from: it can name another skill, an older
// copy, or a directory the checkout supplies, and the block is loaded with eval.
test("the arm block is loaded from the reference shipped beside the script, never from an inherited skill directory", () => {
  const s = makeSeat();
  try {
    const sub = join(s.seat, "sub");
    mkdirSync(sub);
    const planted = join(s.seat, "planted/assets/references");
    mkdirSync(planted, { recursive: true });
    const marker = join(s.dir, "loaded-from-checkout");
    const block = "arm_branch_waiter() {\n  : > " + JSON.stringify(marker) + "\n}\n";
    writeFileSync(join(planted, "branch-waiter.md"), "```bash\n" + block + "```\n");
    // CONTROL: the planted block leaves its marker when it is the one that runs.
    spawnSync("bash", ["-c", `${block}arm_branch_waiter`], { cwd: s.seat, env: s.env, encoding: "utf8", timeout: LONG });
    expect(named(marker)).toBe(true);
    rmSync(marker);
    for (const [cwd, dir] of [[sub, "planted"], [s.seat, "planted"], [s.seat, join(s.seat, "planted")]]) {
      const r = spawnSync("bash", [script, "record", REPO, s.branch, "77", "ENG-123"], { cwd, env: { ...s.env, CLAUDE_SKILL_DIR: dir }, encoding: "utf8", timeout: LONG });
      expect(named(marker)).toBe(false);
      expect(r.stdout).toMatch(/^OWNED: /);
    }
    // The wait that runs is the published one.
    expect(callLinesWith(s, "catalyst events wait-for --ticket ENG-123 --after 100 --timeout 60")).toContain(
      "catalyst events wait-for --ticket ENG-123 --after 100 --timeout 60",
    );
  } finally {
    cleanup(s);
  }
}, LONG);

// With CDPATH set, bash prints the directory a relative cd chose. The waiter and the record enter
// .catalyst by its absolute path, so nothing is printed into the state they read.
test("a CDPATH in the environment does not leak into the waiter's state or the record", () => {
  const s = makeSeat();
  try {
    const env = { CDPATH: "." };
    const r = record(s, 77, "ENG-123", env);
    expect(r.stdout).toMatch(/^OWNED: /);
    expect(savedEntry(s)).toMatchObject({ pr: 77, ticket: "ENG-123", cursor: 100 });
    expect(endRecord(s)).toMatchObject({ end: "waiter", ticket: "ENG-123" });
    expect(check(s, 77, env).stdout).toMatch(/^OWNED: /);
  } finally {
    cleanup(s);
  }
}, LONG);

// GitHub can move the pull request's head while the arm runs. record reads it again after the arm and
// records a reader only against the head it read then.
test("a pull request head that moves while the arm runs is read again, and no reader is recorded against the old head", () => {
  const s = makeSeat();
  try {
    const file = join(s.dir, "pr-head");
    const moved = "f".repeat(40);
    const r = record(s, 77, "ENG-123", { PR_HEAD_FILE: file, MOVE_PR_ON_STATUS: moved });
    // CONTROL: the head did move during the arm.
    expect(readFileSync(file, "utf8")).toBe(moved);
    expect(r.stdout).toMatch(new RegExp(`^NEEDS ATTENTION: .*the pull request is at ${moved} and this branch is at ${s.env.PR_HEAD_SHA}`));
    expect(endRecord(s)).toMatchObject({ end: "needs-attention", head: moved });
    // CONTROL: with the head unmoved, the same record names the reader.
    stopWaits(s.ref);
    expect(record(s).stdout).toMatch(/^OWNED: /);
  } finally {
    cleanup(s);
  }
}, LONG);

// A reader recorded with no ticket, kept by a record that gave one and checked it against the running
// wait, gets that ticket. check then compares a later arm with it.
test("a ticket checked against the running wait is saved on a reader recorded without one, so a later arm for another ticket is caught", () => {
  const s = makeSeat();
  const owner = startOwner();
  try {
    expect(armIn(s, s.seat).stdout).toContain("branch-waiter: armed ");
    expect(record(s, 77, "", { PR_END_STATE_OWNER_PID: String(owner) }).stdout).toMatch(/^OWNED: /);
    expect(endRecord(s)).toMatchObject({ end: "waiter", ticket: "", owner: { pid: owner } });
    const gonePid = startOwner();
    expect(endOwner(gonePid)).toBe(true);
    const kept = record(s, 77, "ENG-123", { PR_END_STATE_OWNER_PID: String(gonePid) });
    expect(kept.stdout).toMatch(/^OWNED: .*the reader on record was kept/);
    expect(endRecord(s)).toMatchObject({ end: "waiter", ticket: "ENG-123", owner: { pid: owner } });
    // The wait is armed again for another ticket: check now sees the difference.
    stopWaits(s.ref);
    expect(armIn(s, s.seat, s.branch, "ENG-456").stdout).toContain("branch-waiter: armed ");
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toMatch(/listens on ticket ENG-456, not ENG-123/);
  } finally {
    endOwner(owner);
    cleanup(s);
  }
}, LONG);

// The wake handler saves the sequence the wait reached, then arms again. When that save fails, the arm
// is handed the sequence itself, saves it, and starts from it: a wake already handled is not delivered
// again from the older one.
test("a failed save of the reached sequence does not re-arm from the older one: the arm is handed it and saves it", () => {
  const s = makeSeat();
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    writeFileSync(waiterLog(s), "cursor 155\nwaiter-rc 124\n");
    writeFileSync(s.calls, "");
    const once = join(s.dir, "mv-refused-once");
    const h = runBlocks(s, `handle_waiter_wake "$0" "$1" ".catalyst/$(_bw_log_name "$0" "$1")"`, { FAIL_STATE_MV_ONCE: once });
    // CONTROL: the handler's own save was refused.
    expect(named(once)).toBe(true);
    expect(h.stderr).toContain("could not save the sequence 155");
    expect(h.stdout).toContain("branch-waiter: armed ");
    expect(savedEntry(s).cursor).toBe(155);
    waitTimeouts(s);
    expect(callLines(s).some((l) => l.includes("--after 155 "))).toBe(true);
    expect(callLines(s).some((l) => l.includes("--after 100 "))).toBe(false);
    // A save that fails every time starts no wait, and the log that holds the reached sequence is kept.
    stopWaits(s.ref);
    writeFileSync(waiterLog(s), "cursor 160\nwaiter-rc 124\n");
    const h2 = runBlocks(s, `handle_waiter_wake "$0" "$1" ".catalyst/$(_bw_log_name "$0" "$1")"`, { FAIL_STATE_MV: "1" });
    expect(h2.stdout).not.toContain("branch-waiter: armed ");
    expect(readFileSync(waiterLog(s), "utf8")).toBe("cursor 160\nwaiter-rc 124\n");
    expect(waitPids(s.ref)).toHaveLength(0);
  } finally {
    cleanup(s);
  }
}, LONG);

// The name of a log can be replaced while its wait runs (a later arm, or a link the checkout carries). The wait
// tells its own timeout from its own output, so it still records 124 in the log it was started with.
test("a wait that times out after its log name was replaced still records a timeout, told from its own output", () => {
  const s = makeSeat();
  try {
    const hold = join(s.dir, "release");
    expect(record(s, 77, "ENG-123", { WAIT_SLEEP: "0", WAIT_HOLD: hold }).stdout).toMatch(/^OWNED: /);
    const out = outsideDir(s);
    renameSync(waiterLog(s), `${waiterLog(s)}.moved`);
    const canary = plant(s, out, logNameOf(s.branch), "outside log\n");
    writeFileSync(hold, "");
    for (let i = 0; i < 150 && !/^waiter-rc /m.test(readFileSync(`${waiterLog(s)}.moved`, "utf8")); i++) spawnSync("sleep", ["0.1"]);
    expect(readFileSync(`${waiterLog(s)}.moved`, "utf8")).toBe(`${armLine(s.branch)}events: no matching event within 1 s\ncursor 100\nwaiter-rc 124\n`);
    expect(readFileSync(canary, "utf8")).toBe("outside log\n");
  } finally {
    cleanup(s);
  }
}, LONG);

// The handler reads its log once, by the name the arm printed, from inside this checkout's own
// .catalyst. A link there is not opened, so a pipe that never ends cannot hold the handler.
test("the wake handler reads its log only as .catalyst/NAME in this checkout, and never opens a link there", () => {
  const s = makeSeat();
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    const out = outsideDir(s);
    const fifo = join(out, "never-ends");
    expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
    rmSync(waiterLog(s), { force: true });
    symlinkSync(fifo, waiterLog(s));
    writeFileSync(s.calls, "");
    const h = runBlocks(s, `handle_waiter_wake "$0" "$1" ".catalyst/$(_bw_log_name "$0" "$1")"`);
    // It returned, so the link was not opened: a read of the pipe would block.
    expect(h.status).toBe(0);
    expect(h.stdout).toContain("branch-waiter: armed ");
    expect(plainFile(waiterLog(s))).toBe(true);
    // A log named any other way is refused before anything is read.
    const elsewhere = join(out, "wake.log");
    writeFileSync(elsewhere, "cursor 155\nwaiter-rc 124\n");
    const o = runBlocks(s, `handle_waiter_wake "$0" "$1" "${elsewhere}"`);
    expect(o.stderr).toContain("the wake log is read only as .catalyst/NAME");
    expect(o.stdout).not.toContain("branch-waiter: armed ");
  } finally {
    cleanup(s);
  }
}, LONG);

// One wait runs per branch on a machine, so a wait on the ref can be another checkout's. The stop signals
// only a wait running in its own checkout, and only for the pull request its own state names.
test("stop stops only a wait running in this checkout, for the pull request its state names", () => {
  const s = makeSeat();
  const other = join(s.dir, "other");
  initCheckout(s, other);
  try {
    expect(armIn(s, other).stdout).toContain("branch-waiter: armed ");
    const pids = waitPids(s.ref);
    expect(pids.length).toBeGreaterThan(0);
    const here = runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
    expect(here.stdout).toContain("running in another checkout was left alone");
    expect(waitPids(s.ref)).toEqual(pids);
    const inOther = (pr) => spawnSync("bash", ["-c", `${allBlocks()}\nstop_branch_waiter "$0" "$1" ${pr}`, REPO, s.branch], { cwd: other, env: { ...s.env, PR_STATE: "merged" }, encoding: "utf8", timeout: LONG });
    const wrong = inOther(78);
    expect(wrong.stdout).toContain("is for PR #77, not #78; nothing stopped");
    expect(waitPids(s.ref)).toEqual(pids);
    // CONTROL: the stop run in the checkout that armed it, for its pull request, stops it.
    const own = inOther(77);
    expect(own.stdout).toContain("branch-waiter: stopped the waiter on ");
    expect(own.stdout).not.toContain("left alone");
    for (const pid of pids) expect(gone(pid)).toBe(true);
  } finally {
    cleanup(s);
  }
}, LONG);

// A tracked waiter file prevents verifying the saved PR. The stop can be retried once the file is untracked.
test("stop refuses a tracked waiter file until the file is untracked", () => {
  const s = makeSeat();
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    expect(s.git("add", "-f", ".catalyst/create-pr-end.json").status).toBe(0);
    const st = runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
    expect(st.status).toBe(1);
    expect(st.stderr).toContain("could not read the waiter state");
    expect(waitPids(s.ref).length).toBeGreaterThan(0);
    expect(st.stdout).not.toContain("stopped the waiter");
    expect(named(waiterLog(s))).toBe(true);
    // CONTROL: untracked again, the same stop removes them and says it stopped.
    expect(s.git("rm", "-q", "--cached", ".catalyst/create-pr-end.json").status).toBe(0);
    const again = runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("branch-waiter: stopped the waiter on ");
    expect(named(waiterLog(s))).toBe(false);
  } finally {
    cleanup(s);
  }
}, LONG);

test("stop keeps a live waiter and its log when its saved PR cannot be verified", () => {
  const s = makeSeat();
  const state = join(s.seat, ".catalyst/branch-waiter.json");
  try {
    expect(armIn(s, s.seat).stdout).toContain("branch-waiter: armed ");
    const pids = waitPids(s.ref);
    const original = JSON.parse(readFileSync(state, "utf8"));
    const otherRef = `${s.ref}-other`;
    original[otherRef] = { pr: 78 };
    const log = readFileSync(waiterLog(s), "utf8");
    for (const content of [null, "{}", JSON.stringify({ [s.ref]: {} }), "{broken"]) {
      if (content === null) rmSync(state);
      else writeFileSync(state, content);
      const st = runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
      expect(waitPids(s.ref)).toEqual(pids);
      expect(st.status).toBe(1);
      expect(st.stderr).toMatch(/saved PR|read.*state/);
      expect(readFileSync(waiterLog(s), "utf8")).toBe(log);
      if (content === null) expect(named(state)).toBe(false);
      else expect(readFileSync(state, "utf8")).toBe(content);
    }
    writeFileSync(state, JSON.stringify(original));
    expect(runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" }).status).toBe(0);
    for (const pid of pids) expect(gone(pid)).toBe(true);
    expect(JSON.parse(readFileSync(state, "utf8"))).toEqual({ [otherRef]: { pr: 78 } });
  } finally {
    cleanup(s);
  }
}, LONG);

test("stop reports unreadable or invalid state even after the waiter exits, and succeeds twice with state absent", () => {
  const s = makeSeat();
  const dir = join(s.seat, ".catalyst");
  const state = join(dir, "branch-waiter.json");
  const stop = () => runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
  try {
    mkdirSync(dir);
    writeFileSync(waiterLog(s), "finished\n");
    for (const content of ["{broken", "", "null", "{}\n{}"]) {
      writeFileSync(state, content);
      const st = stop();
      expect(st.status).toBe(1);
      expect(st.stderr).toMatch(/read.*state/);
      expect(st.stdout).not.toContain("stopped the waiter");
      expect(readFileSync(state, "utf8")).toBe(content);
      expect(readFileSync(waiterLog(s), "utf8")).toBe("finished\n");
    }
    rmSync(state);
    symlinkSync(join(dir, "missing-target"), state);
    expect(stop().status).toBe(1);
    expect(lstatSync(state).isSymbolicLink()).toBe(true);
    rmSync(state);
    const unknown = runBlocks(s, `pgrep() { return 2; }; stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
    expect(unknown.status).toBe(1);
    expect(readFileSync(waiterLog(s), "utf8")).toBe("finished\n");
    expect(stop().status).toBe(0);
    expect(stop().status).toBe(0);
    expect(named(state)).toBe(false);
    expect(named(waiterLog(s))).toBe(false);
  } finally {
    cleanup(s);
  }
}, LONG);

test("stop reports a failed state write after signaling and retries cleanup", () => {
  const s = makeSeat();
  const stop = (env = {}) => runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged", ...env });
  try {
    expect(armIn(s, s.seat).stdout).toContain("branch-waiter: armed ");
    const pids = waitPids(s.ref);
    const st = stop({ FAIL_STATE_MV: "1" });
    expect(st.status).toBe(1);
    expect(st.stderr).toContain("could not remove its log or state");
    for (const pid of pids) expect(gone(pid)).toBe(true);
    expect(savedEntry(s).pr).toBe(77);
    expect(stop().status).toBe(0);
    expect(savedEntry(s)).toBeUndefined();
  } finally {
    cleanup(s);
  }
}, LONG);

test("stop keeps the waiter and its ownership when the checkout lookup fails, then stops it on retry", () => {
  const s = makeSeat();
  try {
    expect(armIn(s, s.seat).stdout).toContain("branch-waiter: armed ");
    const pids = waitPids(s.ref);
    const before = savedEntry(s);
    const log = readFileSync(waiterLog(s), "utf8");
    const st = runBlocks(s, `readlink() { return 1; }; lsof() { return 1; }; stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
    expect(st.status).toBe(1);
    expect(st.stderr).toContain("cannot verify the checkout");
    expect(waitPids(s.ref)).toEqual(pids);
    expect(savedEntry(s)).toEqual(before);
    expect(readFileSync(waiterLog(s), "utf8")).toBe(log);
    expect(runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" }).status).toBe(0);
    for (const pid of pids) expect(gone(pid)).toBe(true);
    expect(savedEntry(s)).toBeUndefined();
    expect(named(waiterLog(s))).toBe(false);
  } finally {
    cleanup(s);
  }
}, LONG);

test("stop under errexit signals a waiter whose last child has already exited", () => {
  const s = makeSeat();
  // A shell blocked in the read builtin has no child. Its argv and cwd identify the fixture waiter.
  const waiter = spawn("bash", ["-c", "read -r line # catalyst events wait-for fixture", s.ref, "hold"], {
    cwd: s.seat, stdio: ["pipe", "ignore", "ignore"],
  });
  try {
    mkdirSync(join(s.seat, ".catalyst"));
    writeFileSync(join(s.seat, ".catalyst/branch-waiter.json"), JSON.stringify({ [s.ref]: { pr: 77 } }));
    writeFileSync(waiterLog(s), "finished\n");
    for (let i = 0; i < 50 && !waitPids(s.ref).includes(waiter.pid); i++) spawnSync("sleep", ["0.1"]);
    expect(waitPids(s.ref)).toEqual([waiter.pid]);
    expect(spawnSync("pgrep", ["-P", String(waiter.pid)]).status).toBe(1);
    const st = runBlocks(s, `set -e; stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
    expect(st.status).toBe(0);
    expect(gone(waiter.pid)).toBe(true);
    expect(savedEntry(s)).toBeUndefined();
    expect(named(waiterLog(s))).toBe(false);
  } finally {
    waiter.stdin.end();
    cleanup(s);
  }
}, LONG);

// ── One reading of the checkout ─────────────────────────────────────────────────────────────────────────────
// The branch and the commit the head check compares come from one `git worktree list --porcelain` of the
// checkout, never from two commands. Two commands let a switch between them pair one branch's name with the
// other branch's commit, so a checkout that was never on the head passed as the owner. These controls drive
// the public `record` and `check` commands, and the `git` stand-in switches the checkout between two reads.

// Where Git keeps this checkout's refs, whichever way it stores them, left as it is on the disk: every file's
// path, size, modification time and content, so a read that wrote anything shows.
function gitDirState(s) {
  const gitDir = join(s.seat, ".git");
  if (!lstatSync(gitDir).isDirectory()) return null;
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const f = join(dir, name);
      const st = lstatSync(f);
      if (st.isDirectory()) walk(f);
      else out.push(`${f.slice(gitDir.length)} ${st.size} ${st.mtimeMs} ${st.isFile() ? readFileSync(f).toString("base64") : ""}`);
    }
  };
  walk(gitDir);
  return out.join("\n");
}
// The seat, now on `line` with one commit that no other branch has. Back on its own branch afterwards.
function commitOnlyOn(s, line, message) {
  expect(s.git("switch", "-q", "-c", line).status).toBe(0);
  expect(s.git("commit", "-q", "--allow-empty", "-m", message).status).toBe(0);
  const sha = s.git("rev-parse", "HEAD").stdout.trim();
  expect(s.git("switch", "-q", s.branch).status).toBe(0);
  return sha;
}
const readLines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []);

for (const refFormat of REF_FORMATS) {
  // FAILS on the two-command read: the first command says the checkout is on its branch, the checkout
  // switches to the other branch, and the second command reads the other branch's commit, which is the
  // pull request's head. Only the other branch ever held that commit.
  test(`${refFormat} refs: a switch between the branch and the commit reads cannot make a checkout the owner of a commit only the other branch held`, () => {
    const s = makeSeat({ gitShim: true, refFormat });
    try {
      const c1 = s.env.PR_HEAD_SHA;
      const c2 = commitOnlyOn(s, "other-line", "only the other branch has this");
      expect(c2).not.toBe(c1);
      // CONTROL: on its own branch at the pull request's head, the checkout is the owner.
      expect(record(s, 77, "ENG-123", { WAIT_SLEEP: "120" }).stdout).toMatch(/^OWNED: /);
      expect(check(s).status).toBe(0);
      // The pull request now sits at c2. CONTROL: with no switch the checkout is not on it.
      const calm = check(s, 77, { PR_HEAD_SHA: c2 });
      expect(calm.status).toBe(9);
      expect(calm.stderr).toContain(`the pull request is at ${c2} and this branch is at ${c1}`);
      // The switch happens right after the first read of the checkout.
      const log = join(s.dir, "observed-race");
      const raced = check(s, 77, { PR_HEAD_SHA: c2, OBSERVE_LOG: log, FLIP_TO: "other-line" });
      // CONTROL: the switch really happened, so this run was raced.
      expect(s.git("branch", "--show-current").stdout.trim()).toBe("other-line");
      expect(raced.stdout).not.toContain("OWNED");
      expect(raced.status).toBe(9);
      expect(raced.stderr).toContain(`the pull request is at ${c2} and this branch is at ${c1}`);
      // One Git read of the checkout for the one comparison, and it is the worktree listing.
      expect(readLines(log)).toHaveLength(1);
      expect(readLines(log)[0]).toMatch(/^git worktree list --porcelain/);
    } finally {
      cleanup(s);
    }
  }, LONG);

  // FAILS on the two-command read: the first read is the branch, so a wait is armed for a checkout that is then
  // found to be elsewhere, and is left running.
  test(`${refFormat} refs: record starts no wait when a switch follows the first read of a commit only the other branch held`, () => {
    const s = makeSeat({ gitShim: true, refFormat });
    try {
      const c1 = s.env.PR_HEAD_SHA;
      const c2 = commitOnlyOn(s, "other-line", "only the other branch has this");
      const r = record(s, 77, "ENG-123", { PR_HEAD_SHA: c2, OBSERVE_LOG: join(s.dir, "observed"), FLIP_TO: "other-line" });
      expect(s.git("branch", "--show-current").stdout.trim()).toBe("other-line");
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("OWNED");
      expect(r.stdout).toMatch(new RegExp(`^NEEDS ATTENTION: pull request #77 is open and nothing owns it\\. the pull request is at ${c2} and this branch is at ${c1}`));
      expect(waitPids(s.ref)).toEqual([]);
      expect(endRecord(s).end).toBe("needs-attention");
    } finally {
      cleanup(s);
    }
  }, LONG);

  // The scope of one reading. A switch after the read is not in it: the run reports what the read showed, and the
  // next run reads the checkout again and says where it is.
  test(`${refFormat} refs: a switch after the reading is not seen by it, and the next check reports it`, () => {
    const s = makeSeat({ gitShim: true, refFormat });
    try {
      commitOnlyOn(s, "other-line", "somewhere else");
      expect(record(s, 77, "ENG-123", { WAIT_SLEEP: "120" }).stdout).toMatch(/^OWNED: /);
      const log = join(s.dir, "observed-after");
      const r = check(s, 77, { OBSERVE_LOG: log, FLIP_TO: "other-line" });
      expect(s.git("branch", "--show-current").stdout.trim()).toBe("other-line");
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^OWNED: /);
      expect(readLines(log)).toHaveLength(1);
      const next = check(s);
      expect(next.status).toBe(9);
      expect(next.stderr).toContain(`this checkout is on other-line, not on ${s.branch}`);
    } finally {
      cleanup(s);
    }
  }, LONG);

  // The refs the read goes through. The branch is named by its full ref, so a tag of the same name is not it, and a
  // branch that is only in packed-refs (or in the reftable) reads as it does when it is loose.
  test(`${refFormat} refs: a same-named tag, packed refs and a loose ref over a packed one`, () => {
    const s = makeSeat({ refFormat });
    try {
      const c1 = s.env.PR_HEAD_SHA;
      const c2 = commitOnlyOn(s, "other-line", "only the other branch has this");
      // A tag named like the branch, at the other commit: a read by short name would find the tag.
      expect(s.git("tag", s.branch, c2).status).toBe(0);
      const tagged = record(s, 77, "ENG-123", { PR_HEAD_SHA: c2 });
      expect(tagged.stdout).toMatch(new RegExp(`^NEEDS ATTENTION: .* the pull request is at ${c2} and this branch is at ${c1}`));
      expect(record(s, 77, "ENG-123", { WAIT_SLEEP: "120" }).stdout).toMatch(/^OWNED: /);
      // Everything packed (the reftable is compacted).
      expect(s.git("pack-refs", "--all").status).toBe(0);
      expect(check(s).status).toBe(0);
      const packedWrong = check(s, 77, { PR_HEAD_SHA: c2 });
      expect(packedWrong.status).toBe(9);
      expect(packedWrong.stderr).toContain(`the pull request is at ${c2} and this branch is at ${c1}`);
      // A new commit is a loose ref over the packed one: the pull request's old head is no longer the branch's.
      expect(s.git("commit", "-q", "--allow-empty", "-m", "newer than the packed ref").status).toBe(0);
      const c3 = s.git("rev-parse", "HEAD").stdout.trim();
      const stale = check(s, 77, { PR_HEAD_SHA: c1 });
      expect(stale.status).toBe(9);
      expect(stale.stderr).toContain(`the pull request is at ${c1} and this branch is at ${c3}`);
      expect(check(s, 77, { PR_HEAD_SHA: c3 }).status).toBe(0);
    } finally {
      cleanup(s);
    }
  }, LONG);

  // A read does not write: not a ref, not an index, not a lock, and no hook runs.
  test(`${refFormat} refs: reading the checkout writes nothing under .git and runs no hook, also when .git is read-only`, () => {
    const s = makeSeat({ refFormat });
    const gitDir = join(s.seat, ".git");
    try {
      expect(record(s, 77, "ENG-123", { WAIT_SLEEP: "120" }).stdout).toMatch(/^OWNED: /);
      const hookLog = join(s.dir, "hooks-run");
      const hook = `#!/bin/sh\necho "$0" >> "${hookLog}"\ncat >/dev/null 2>&1\nexit 0\n`;
      for (const name of ["reference-transaction", "post-checkout", "post-index-change", "post-commit", "post-merge", "post-rewrite", "pre-auto-gc", "fsmonitor-watchman"]) {
        mkdirSync(join(gitDir, "hooks"), { recursive: true });
        writeFileSync(join(gitDir, "hooks", name), hook, { mode: 0o755 });
      }
      writeFileSync(join(s.dir, "fsmonitor"), hook, { mode: 0o755 });
      expect(s.git("config", "core.fsmonitor", join(s.dir, "fsmonitor")).status).toBe(0);
      const before = gitDirState(s);
      const open = check(s);
      expect(open.status).toBe(0);
      expect(open.stdout).toMatch(/^OWNED: /);
      const off = check(s, 77, { PR_HEAD_SHA: "f".repeat(40) });
      expect(off.status).toBe(9);
      expect(gitDirState(s)).toBe(before);
      // The same with every file and directory of .git read-only (the check does not run as root where this binds).
      expect(spawnSync("chmod", ["-R", "a-w", gitDir]).status).toBe(0);
      const locked = check(s);
      const lockedOff = check(s, 77, { PR_HEAD_SHA: "f".repeat(40) });
      expect(spawnSync("chmod", ["-R", "u+w", gitDir]).status).toBe(0);
      expect(locked.status).toBe(0);
      expect(locked.stdout).toMatch(/^OWNED: /);
      expect(lockedOff.status).toBe(9);
      expect(lockedOff.stderr).toMatch(/the pull request is at f{40} and this branch is at [0-9a-f]{40}/);
      expect(gitDirState(s)).toBe(before);
      // No hook ran for any of it.
      expect(existsSync(hookLog)).toBe(false);
    } finally {
      spawnSync("chmod", ["-R", "u+w", gitDir]);
      cleanup(s);
    }
  }, LONG);

  // Detached, no commit yet, and a branch ref that does not resolve each say so and never pass.
  // CONTROL: the same checkout was the owner before.
  test(`${refFormat} refs: a detached HEAD, a branch with no commit and a damaged branch ref are not owners`, () => {
    const s = makeSeat({ refFormat });
    try {
      expect(record(s, 77, "ENG-123", { WAIT_SLEEP: "120" }).stdout).toMatch(/^OWNED: /);
      expect(check(s).status).toBe(0);
      if (refFormat === "files") {
        // A branch ref that holds no object name.
        const ref = join(s.seat, ".git/refs/heads", s.branch);
        const good = readFileSync(ref, "utf8");
        writeFileSync(ref, "damaged\n");
        const damaged = check(s);
        expect(damaged.status).toBe(9);
        expect(damaged.stdout).not.toContain("OWNED");
        expect(damaged.stderr).toContain(`this checkout is not on ${s.branch}: its HEAD does not resolve to a branch at a commit`);
        writeFileSync(ref, good);
        expect(check(s).status).toBe(0);
      }
      // No commit yet on the branch.
      expect(s.git("update-ref", "-d", `refs/heads/${s.branch}`).status).toBe(0);
      const unborn = check(s);
      expect(unborn.status).toBe(9);
      expect(unborn.stderr).toMatch(/NEEDS ATTENTION: .* the pull request is at [0-9a-f]{40} and this branch is at an unknown commit/);
      expect(s.git("update-ref", `refs/heads/${s.branch}`, s.env.PR_HEAD_SHA).status).toBe(0);
      expect(check(s).status).toBe(0);
      // Detached, at the very commit.
      expect(s.git("switch", "-q", "--detach", s.env.PR_HEAD_SHA).status).toBe(0);
      const detached = check(s);
      expect(detached.status).toBe(9);
      expect(detached.stderr).toContain(`this checkout is on no branch, not on ${s.branch}`);
      expect(record(s, 77, "ENG-123").stdout).toMatch(new RegExp(`^NEEDS ATTENTION: .*this checkout is on no branch, not on ${s.branch}`));
    } finally {
      cleanup(s);
    }
  }, LONG);
}

// Include both internal and trailing control characters in the current checkout's actual directory.
const ODD_NAME = "odd dir \"q\" 'sq' $x; one\ntwo é\t\n";
// The seat's main checkout stays on its branch at the pull request's head. A linked checkout in an odd directory is
// on a branch of its own, and a second linked checkout is detached at the head.
function withLinked(s, oddName = ODD_NAME) {
  const odd = join(s.dir, oddName);
  const sibling = join(s.dir, "sibling");
  // A branch no other control uses: the waits are found by ref across the whole machine.
  const branch = freshBranch();
  s.linked = branch;
  expect(s.git("worktree", "add", "-q", "-b", branch, odd).status).toBe(0);
  expect(spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Seat", "-c", "user.email=seat@example.com", "commit", "-q", "--allow-empty", "-m", "linked work"], { cwd: odd, env: s.env, encoding: "utf8" }).status).toBe(0);
  const linkedSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: odd, env: s.env, encoding: "utf8" }).stdout.trim();
  expect(s.git("worktree", "add", "-q", "--detach", sibling, s.env.PR_HEAD_SHA).status).toBe(0);
  return { odd, sibling, linkedSha, branch, linkedRef: refOf(branch) };
}
const recordFor = (s, branch, sha, cwd, extraEnv = {}) => run(s, ["record", REPO, branch, "77", "ENG-123"], { PR_HEAD_SHA: sha, ...extraEnv }, cwd);
const checkFor = (s, branch, sha, cwd, extraEnv = {}) => run(s, ["check", REPO, branch, "77"], { PR_HEAD_SHA: sha, ...extraEnv }, cwd);

for (const refFormat of REF_FORMATS) {
  // The main checkout is on the branch asked for, at the pull request's head, and a second linked checkout is detached at
  // that commit. A read that took the first record, or any record but this checkout's, would pass this one.
  test(`${refFormat} refs: a linked checkout in an odd directory is read as itself, not as the main checkout or another linked one`, () => {
    const s = makeSeat({ refFormat });
    const l = withLinked(s);
    try {
      const wrong = recordFor(s, s.branch, s.env.PR_HEAD_SHA, l.odd);
      expect(wrong.status).toBe(0);
      expect(wrong.stdout).not.toContain("OWNED");
      expect(wrong.stdout).toContain(`this checkout is on ${l.branch}, not on ${s.branch}`);
      expect(waitPids(s.ref)).toEqual([]);
      const wrongCheck = checkFor(s, s.branch, s.env.PR_HEAD_SHA, l.odd);
      expect(wrongCheck.status).toBe(9);
      // Its own branch at a commit the pull request is not at, though the main and the second checkout are at the head.
      const off = recordFor(s, l.branch, s.env.PR_HEAD_SHA, l.odd);
      expect(off.stdout).toMatch(new RegExp(`^NEEDS ATTENTION: .* the pull request is at ${s.env.PR_HEAD_SHA} and this branch is at ${l.linkedSha}`));
      expect(waitPids(l.linkedRef)).toEqual([]);
      // CONTROL: its own branch at its own head is the owner, from the same directory.
      const own = recordFor(s, l.branch, l.linkedSha, l.odd, { WAIT_SLEEP: "120" });
      expect(own.stdout).toMatch(/^OWNED: /);
      expect(waitPids(l.linkedRef).length).toBeGreaterThan(0);
      const ownCheck = checkFor(s, l.branch, l.linkedSha, l.odd);
      expect(ownCheck.status).toBe(0);
      expect(ownCheck.stdout).toMatch(/^OWNED: /);
      // The pids are read before the stop, and each is seen out: a list read right after a signal can still hold one.
      const linkedPids = waitPids(l.linkedRef);
      const ended = runBlocks({ ...s, seat: l.odd, branch: l.branch }, 'stop_branch_waiter "$0" "$1" 77', { PR_STATE: "merged" });
      expect(ended.status).toBe(0);
      for (const pid of linkedPids) expect(gone(pid)).toBe(true);
      expect(waitPids(l.linkedRef)).toEqual([]);
      // The main checkout is read as itself too: the linked checkouts are not it.
      const main = record(s, 77, "ENG-123", { WAIT_SLEEP: "120" });
      expect(main.stdout).toMatch(/^OWNED: /);
      expect(check(s).status).toBe(0);
    } finally {
      if (s.linked) stopWaits(refOf(s.linked));
      cleanup(s);
    }
  }, LONG);

  // Where the checkout is, spelled and moved. A link to it is the same directory; a move Git knows about keeps its
  // record; a move by hand leaves a record at the old place, and reads as nothing until Git repairs it.
  test(`${refFormat} refs: the checkout is found by its directory, through a link, after git worktree move, and not after a move by hand`, () => {
    const s = makeSeat({ refFormat });
    const l = withLinked(s, "first place");
    try {
      const viaLink = join(s.dir, "link-to-linked");
      symlinkSync(l.odd, viaLink);
      expect(recordFor(s, l.branch, l.linkedSha, viaLink, { WAIT_SLEEP: "120" }).stdout).toMatch(/^OWNED: /);
      expect(checkFor(s, l.branch, l.linkedSha, viaLink).status).toBe(0);
      expect(checkFor(s, l.branch, l.linkedSha, l.odd).status).toBe(0);
      stopWaits(l.linkedRef);
      // A move that Git made.
      const moved = join(s.dir, "second place");
      expect(s.git("worktree", "move", l.odd, moved).status).toBe(0);
      const afterMove = recordFor(s, l.branch, l.linkedSha, moved, { WAIT_SLEEP: "120" });
      expect(afterMove.stdout).toMatch(/^OWNED: /);
      stopWaits(l.linkedRef);
      // A move by hand.
      const byHand = join(s.dir, "third place");
      renameSync(moved, byHand);
      const lost = recordFor(s, l.branch, l.linkedSha, byHand);
      expect(lost.status).toBe(0);
      expect(lost.stdout).not.toContain("OWNED");
      expect(lost.stdout).toContain("this checkout is not in the list of worktrees Git gave");
      expect(lost.stdout).toContain("git worktree repair");
      expect(waitPids(l.linkedRef)).toEqual([]);
      expect(s.git("worktree", "repair", byHand).status).toBe(0);
      expect(recordFor(s, l.branch, l.linkedSha, byHand, { WAIT_SLEEP: "120" }).stdout).toMatch(/^OWNED: /);
    } finally {
      if (s.linked) stopWaits(refOf(s.linked));
      cleanup(s);
    }
  }, LONG);

  // The main checkout when its git directory is somewhere else: Git lists the git directory as that worktree's path.
  test(`${refFormat} refs: a main checkout whose git directory is elsewhere is still read as itself`, () => {
    const s = makeSeat({ refFormat, separateGitDir: true });
    try {
      const listing = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: s.seat, env: s.env, encoding: "utf8" }).stdout;
      // CONTROL: Git does list the git directory, not the checkout.
      expect(listing).toContain(`worktree ${realpathSync(join(s.dir, "gitdir"))}\n`);
      expect(listing).not.toContain(`worktree ${realpathSync(s.seat)}\n`);
      expect(record(s, 77, "ENG-123", { WAIT_SLEEP: "120" }).stdout).toMatch(/^OWNED: /);
      expect(check(s).status).toBe(0);
      const off = check(s, 77, { PR_HEAD_SHA: "e".repeat(40) });
      expect(off.status).toBe(9);
      expect(off.stderr).toContain(`the pull request is at ${"e".repeat(40)} and this branch is at ${s.env.PR_HEAD_SHA}`);
    } finally {
      cleanup(s);
    }
  }, LONG);
}

// A listing that did not end well says nothing about the checkout, whatever it shows before it ends.
test("a worktree listing that fails part way is not a reading, even when its first record looks right", () => {
  const s = makeSeat({ gitShim: true });
  try {
    const c2 = commitOnlyOn(s, "other-line", "somewhere else");
    // The checkout is not on the head, and the dying Git's record says it is on the branch at the head.
    const r = record(s, 77, "ENG-123", { PR_HEAD_SHA: c2, DIE_MID: "1", FORGED_SHA: c2, FORGED_BRANCH: s.branch });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("OWNED");
    expect(r.stdout).toContain("this checkout is not in the list of worktrees Git gave");
    expect(waitPids(s.ref)).toEqual([]);
    // CONTROL: without the failure the same stand-in reads the checkout, which is not on c2.
    expect(record(s, 77, "ENG-123", { PR_HEAD_SHA: c2 }).stdout).toMatch(new RegExp(`the pull request is at ${c2} and this branch is at ${s.env.PR_HEAD_SHA}`));
  } finally {
    cleanup(s);
  }
}, LONG);

// No Git before 2.36 has `worktree list -z`. The line form of the same listing is read there, still once.
// Paths are matched against their full registration, including newlines. A doubled registration is ambiguous.
test("a Git without worktree list -z matches whole registered paths and refuses duplicate registrations", () => {
  const s = makeSeat({ gitShim: true });
  try {
    const log = join(s.dir, "observed-old");
    const old = { OLD_GIT: "1", OBSERVE_LOG: log };
    const first = record(s, 77, "ENG-123", { ...old, WAIT_SLEEP: "120" });
    expect(first.stdout).toMatch(/^OWNED: /);
    expect(readLines(log).every((l) => /^git worktree list --porcelain$/.test(l))).toBe(true);
    const c = check(s, 77, old);
    expect(c.status).toBe(0);
    const off = check(s, 77, { ...old, PR_HEAD_SHA: "d".repeat(40) });
    expect(off.status).toBe(9);
    expect(off.stderr).toContain(`the pull request is at ${"d".repeat(40)} and this branch is at ${s.env.PR_HEAD_SHA}`);
    const l = withLinked(s, ".linked seat with spaces");
    expect(check(s, 77, old).status).toBe(0);
    const accepted = recordFor(s, l.branch, l.linkedSha, l.odd, { ...old, WAIT_SLEEP: "120" });
    expect(accepted.stdout).toMatch(/^OWNED: /);
    expect(checkFor(s, l.branch, l.linkedSha, l.odd, old).status).toBe(0);
    const wrong = checkFor(s, s.branch, s.env.PR_HEAD_SHA, l.odd, old);
    expect(wrong.status).toBe(9);
    stopWaits(l.linkedRef);
    const odd = join(s.dir, ODD_NAME);
    expect(s.git("worktree", "move", l.odd, odd).status).toBe(0);
    if (s.git("worktree", "list", "--porcelain", "-z").status === 0) expect(check(s).status).toBe(0);
    expect(check(s, 77, old).status).toBe(0);
    expect(recordFor(s, l.branch, l.linkedSha, odd, { ...old, WAIT_SLEEP: "120" }).stdout).toMatch(/^OWNED: /);
    const admin = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: l.sibling, env: s.env, encoding: "utf8" }).stdout.trim();
    writeFileSync(join(admin, "gitdir"), join(odd, ".git") + "\n");
    const ambiguous = checkFor(s, l.branch, l.linkedSha, odd, old);
    expect(ambiguous.status).toBe(9);
    expect(ambiguous.stderr).toContain("git worktree repair");
    expect(odd).toContain("\n");
  } finally {
    if (s.linked) stopWaits(refOf(s.linked));
    cleanup(s);
  }
}, LONG);

// Where the command is not run from a checkout there is nothing to read, and it says so as it did.
test("from a bare repository, from inside .git and from outside any repository, check reads nothing and writes nothing", () => {
  const s = makeSeat();
  try {
    const bare = join(s.dir, "bare.git");
    expect(spawnSync("git", ["clone", "-q", "--bare", s.seat, bare], { env: s.env, encoding: "utf8" }).status).toBe(0);
    const outside = join(s.dir, "outside");
    mkdirSync(outside);
    for (const cwd of [bare, join(s.seat, ".git"), outside]) {
      const r = check(s, 77, {}, cwd);
      expect(r.status).toBe(9);
      expect(r.stderr).toContain("not in a git checkout");
      expect(r.stdout).not.toContain("OWNED");
      expect(existsSync(join(cwd, ".catalyst"))).toBe(false);
    }
    expect(existsSync(join(s.seat, ".catalyst/create-pr-end.json"))).toBe(false);
  } finally {
    cleanup(s);
  }
}, LONG);

// --- One waiter identity: the repository's name without case, the branch exactly, one log per ref ---

// Two branch names that differ only in characters the older log name did not keep ("feature/api" and
// "feature-api") shared one log, so the exit of one was read as the other's. Each has its own log now, named
// with a digest of the whole ref. The older name is still read for a branch that is alone under it, and for
// neither of two that share it.
test("two branches with one older log name each read only their own log", () => {
  const base = freshBranch();
  const s = makeSeat({ branch: `${base}/api` });
  const twin = `${base}-api`;
  const state = join(s.seat, ".catalyst/branch-waiter.json");
  try {
    expect(slugOf(s.branch)).toBe(slugOf(twin));
    expect(logNameOf(s.branch)).not.toBe(logNameOf(twin));
    expect(record(s).stdout).toMatch(/^OWNED: /);
    expect(readFileSync(waiterLog(s), "utf8").startsWith(armLine(s.branch))).toBe(true);
    // The twin's wait ended in an error. Its log is its own, so this branch's wait is still owned.
    writeFileSync(join(s.seat, ".catalyst", logNameOf(twin)), `${armLine(twin)}it broke\nwaiter-rc 3\n`);
    expect(check(s).stdout).toMatch(/^OWNED: /);
    // The older name with two entries of the state under it: whose log it is cannot be told, so it is not read.
    stopWaits(s.ref);
    rmSync(waiterLog(s));
    const st = JSON.parse(readFileSync(state, "utf8"));
    writeFileSync(state, JSON.stringify({ ...st, [refOf(twin)]: { pr: 78, ticket: "ENG-456", cursor: 100 } }));
    writeFileSync(oldWaiterLog(s), "it broke\nwaiter-rc 3\n");
    const shared = check(s);
    expect(shared.status).toBe(9);
    expect(shared.stderr).not.toContain("waiter-rc 3");
    expect(shared.stderr).toMatch(/is not running\. Arm it again with record\.$/m);
    // CONTROL: the same older log, with this branch alone under its name, is read as it always was.
    writeFileSync(state, JSON.stringify(st));
    expect(check(s).stderr).toMatch(/\(waiter-rc 3\)\. Stop and report it/);
  } finally {
    cleanup(s);
  }
}, LONG);

// GitHub compares a repository's name without case, and so do the waiter and the record: a second spelling
// is the same waiter, the same log and the same record, under the key that was saved first.
test("a repository name in another case is the same waiter, the same log and the same record", () => {
  const s = makeSeat();
  const upper = "Coalesce-Labs/Example";
  const keysOf = (name) => Object.keys(JSON.parse(readFileSync(join(s.seat, ".catalyst", name), "utf8")));
  const wait = "catalyst events wait-for --ticket ENG-123 --after 100 --timeout 60";
  try {
    expect(logNameOf(s.branch, upper)).toBe(logNameOf(s.branch));
    expect(record(s).stdout).toMatch(/^OWNED: /);
    const again = run(s, ["record", upper, s.branch, "77", "ENG-123"]);
    expect(again.stdout).toMatch(/^OWNED: .*The wait was already running/);
    expect(callLinesWith(s, wait).filter((l) => l.startsWith("catalyst events wait-for "))).toEqual([wait]);
    expect(keysOf("branch-waiter.json")).toEqual([s.ref]);
    expect(keysOf("create-pr-end.json")).toEqual([`${s.ref}#77`]);
    const c = run(s, ["check", upper, s.branch, "77"]);
    expect(c.status).toBe(0);
    expect(c.stdout).toMatch(/^OWNED: /);
    // GitHub's own spelling of the name is the one printed.
    const spelled = check(s, 77, { PR_REPO_NAME: upper });
    expect(spelled.stdout).toContain(`OWNED: a waiter is running on ${upper}:${s.branch} `);
    // The stop finds the wait, the log and the state under either spelling.
    const pids = waitPids(s.ref);
    expect(pids.length).toBeGreaterThan(0);
    const st = spawnSync("bash", ["-c", `${allBlocks()}\nstop_branch_waiter "$0" "$1" 77`, upper, s.branch], { cwd: s.seat, env: { ...s.env, PR_STATE: "merged" }, encoding: "utf8", timeout: LONG });
    expect(st.stdout).toContain("branch-waiter: stopped the waiter on ");
    for (const pid of pids) expect(gone(pid)).toBe(true);
    expect(keysOf("branch-waiter.json")).toEqual([]);
    expect(named(waiterLog(s))).toBe(false);
    // A handoff under the other spelling replaces the one record, and both spellings read it.
    const h = run(s, ["handoff", upper, s.branch, "77", "ticket:ENG-123", "msg_01", "next-turn"]);
    expect(h.stdout).toMatch(/^HANDED-OFF: /);
    expect(keysOf("create-pr-end.json")).toEqual([`${s.ref}#77`]);
    expect(check(s).stdout).toMatch(/^HANDED-OFF: /);
  } finally {
    cleanup(s);
  }
}, LONG);

// One branch saved under two spellings cannot be resolved here: which entry is this pull request's is not
// known, so every command refuses and changes nothing.
test("one branch saved under two spellings of the repository's name is refused, and nothing is armed, recorded or stopped", () => {
  const s = makeSeat();
  const upper = "Coalesce-Labs/Example";
  const state = join(s.seat, ".catalyst/branch-waiter.json");
  try {
    mkdirSync(join(s.seat, ".catalyst"));
    const entry = { pr: 77, ticket: "ENG-123", cursor: 100 };
    const both = { [s.ref]: entry, [`${upper}:${s.branch}`]: entry };
    writeFileSync(state, JSON.stringify(both));
    const r = record(s);
    expect(r.status).toBe(9);
    expect(r.stderr).toContain("under two spellings of the repository's name");
    expect(r.stdout).toBe("");
    expect(hasEndFile(s)).toBe(false);
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toContain("under two spellings of the repository's name");
    const a = armIn(s, s.seat);
    expect(a.stderr).toContain("under two spellings of the repository's name");
    expect(a.stdout).not.toContain("branch-waiter: armed ");
    expect(waitPids(s.ref)).toEqual([]);
    const st = runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
    expect(st.status).toBe(1);
    expect(st.stderr).toContain("Nothing stopped");
    expect(JSON.parse(readFileSync(state, "utf8"))).toEqual(both);
    // CONTROL: with one of the two entries, the same command arms and records.
    writeFileSync(state, JSON.stringify({ [s.ref]: entry }));
    expect(record(s).stdout).toMatch(/^OWNED: /);
  } finally {
    cleanup(s);
  }
}, LONG);

// An arm saves its pull request in the state before its log takes the log's name. When the log cannot take
// it, the log there is still the one of the wait before. Its first line says which pull request that wait was
// armed for, so its exit is not read as the exit of the pull request the state names now.
test("a log armed for one pull request is not read as the log of the pull request the state names now", () => {
  const s = makeSeat();
  const state = join(s.seat, ".catalyst/branch-waiter.json");
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    // An arm whose log cannot take its name starts no wait and says so, and the log before it stays.
    const refused = armIn(s, s.seat, s.branch, "ENG-123", { FAIL_LOG_MV: "1" });
    expect(refused.stderr).toContain("cannot create the log for ");
    expect(refused.stdout).not.toContain("branch-waiter: armed ");
    expect(waitPids(s.ref)).toEqual([]);
    expect(readFileSync(waiterLog(s), "utf8").startsWith(armLine(s.branch))).toBe(true);
    expect(readdirSync(join(s.seat, ".catalyst")).sort()).toEqual(["branch-waiter.json", "create-pr-end.json", logNameOf(s.branch)].sort());
    writeFileSync(waiterLog(s), `${armLine(s.branch)}it broke\nwaiter-rc 3\n`);
    // CONTROL: for the pull request the log was armed for, its failed exit is reported and nothing is armed.
    const same = record(s);
    expect(same.stdout).toMatch(/^NEEDS ATTENTION: .*the last wait on .* failed \(waiter-rc 3\): it broke/);
    expect(waitPids(s.ref)).toEqual([]);
    // The state names #78 now, and the log is still #77's.
    const st = JSON.parse(readFileSync(state, "utf8"));
    st[s.ref].pr = 78;
    writeFileSync(state, JSON.stringify(st));
    expect(check(s, 78).stderr).not.toContain("waiter-rc 3");
    expect(record(s, 78).stdout).toMatch(/^OWNED: /);
    expect(readFileSync(waiterLog(s), "utf8").startsWith(armLine(s.branch, { pr: 78 }))).toBe(true);
  } finally {
    cleanup(s);
  }
}, LONG);

// A conflict whose pull request could not be read stays pending, with the time its next try is due. The
// sequence reached, the pending count and the due time are one checkpoint: when the handler's own save of it
// fails, the arm is handed all three and saves them in the one write it makes before it starts the wait.
test("a pending conflict and its due time survive a failed save by the handler: the arm saves the whole checkpoint", () => {
  const s = makeSeat();
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    const event = JSON.stringify({ sequence: 155, type: "pr.conflict.detected", payload: { repo: REPO, pr: 77 } });
    writeFileSync(waiterLog(s), `${armLine(s.branch)}${event}\ncursor 155\nwaiter-rc 0\n`);
    writeFileSync(s.calls, "");
    const once = join(s.dir, "mv-refused-once");
    const t0 = nowSec();
    const h = runBlocks(s, `handle_waiter_wake "$0" "$1" ".catalyst/$(_bw_log_name "$0" "$1")"`, { FAIL_STATE_MV_ONCE: once, GH_FAIL: "1" });
    const t1 = nowSec();
    // CONTROLS: the pull request could not be read, and the handler's own save was refused.
    expect(h.stderr).toContain("cannot read the base and head of PR #77 (try 1 of 3)");
    expect(named(once)).toBe(true);
    expect(h.stderr).toContain("could not save the sequence 155");
    expect(h.stdout).toContain("branch-waiter: armed ");
    const saved = savedEntry(s);
    expect(saved).toMatchObject({ pr: 77, ticket: "ENG-123", cursor: 155, pending: 1 });
    expect(saved.due).toBeGreaterThanOrEqual(t0 + 300);
    expect(saved.due).toBeLessThanOrEqual(t1 + 300);
    expect(waitTimeouts(s)).toEqual([300]);
    expect(callLines(s).some((l) => l.includes("--after 155 "))).toBe(true);
  } finally {
    cleanup(s);
  }
}, LONG);

// A signal that does not end the wait is not a stop. The log and the saved pull request are what the next
// stop verifies, so they stay until the wait has left the process list.
test("a stop whose signal does not end the wait keeps the log and the state and says so, and the next stop ends it", () => {
  const s = makeSeat();
  try {
    expect(record(s, 77, "ENG-123", { WAIT_SLEEP: "120" }).stdout).toMatch(/^OWNED: /);
    const before = savedEntry(s);
    expect(waitPids(s.ref).length).toBeGreaterThan(0);
    // The stop's own signals reach nothing: kill and pkill are stand-ins that fail.
    const st = runBlocks(s, `kill() { return 1; }; pkill() { return 1; }; stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
    expect(st.status).toBe(1);
    expect(st.stderr).toContain("was signalled and is still running");
    expect(st.stdout).not.toContain("stopped the waiter");
    expect(savedEntry(s)).toEqual(before);
    expect(named(waiterLog(s))).toBe(true);
    const pids = waitPids(s.ref);
    expect(pids.length).toBeGreaterThan(0);
    // CONTROL: the same stop with real signals ends the wait and clears its files.
    const ok = runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("branch-waiter: stopped the waiter on ");
    for (const pid of pids) expect(gone(pid)).toBe(true);
    expect(savedEntry(s)).toBeUndefined();
    expect(named(waiterLog(s))).toBe(false);
  } finally {
    cleanup(s);
  }
}, LONG);

// The pull request is read again after the arm. A read that fails then says nothing about the pull request:
// the record there is stays as it was, and the command fails so that its caller runs it again.
test("a failed read of the pull request after the arm leaves the record as it was", () => {
  const s = makeSeat();
  const end = join(s.seat, ".catalyst/create-pr-end.json");
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    const before = readFileSync(end, "utf8");
    stopWaits(s.ref);
    const file = join(s.dir, "pr-state");
    const r = record(s, 77, "ENG-123", { PR_STATE_FILE: file, MOVE_STATE_ON_STATUS: "unreadable" });
    // CONTROL: the arm ran, and the read after it is the one that failed.
    expect(readFileSync(file, "utf8")).toBe("unreadable");
    expect(r.status).toBe(9);
    expect(r.stderr).toContain("again after the arm");
    expect(r.stdout).toBe("");
    expect(readFileSync(end, "utf8")).toBe(before);
    expect(endRecord(s)).toMatchObject({ end: "waiter", owner: { pid: process.pid } });
  } finally {
    cleanup(s);
  }
}, LONG);

test("a pull request merged while the wait was armed is FINISHED, as when the first read finds it so", () => {
  const s = makeSeat();
  try {
    const file = join(s.dir, "pr-state");
    const r = record(s, 77, "ENG-123", { PR_STATE_FILE: file, MOVE_STATE_ON_STATUS: "merged" });
    // CONTROL: the first read found it open, and it was merged by the read after the arm.
    expect(readFileSync(file, "utf8")).toBe("merged");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^FINISHED: pull request #77 is merged; there is nothing to own\.$/m);
    expect(r.stdout).not.toContain("NEEDS ATTENTION");
    expect(endRecord(s)).toMatchObject({ pr: 77, end: "merged" });
    const first = record(s, 77, "ENG-123", { PR_STATE: "closed" });
    expect(first.stdout).toMatch(/^FINISHED: pull request #77 is closed; there is nothing to own\.$/m);
  } finally {
    cleanup(s);
  }
}, LONG);

// A branch with no ticket key in its name has the ticket nowhere but the record and the waiter's state. With
// a conflict retry pending and no record left, check prints the record command with the ticket the state
// holds for this pull request, so it runs as printed. Another pull request's ticket is never used.
test("check prints a record command that runs, with the saved ticket of this pull request and never another's", () => {
  const s = makeSeat();
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    rmSync(join(s.seat, ".catalyst/create-pr-end.json"));
    pendIn(s, 30, "cursor 100\nwaiter-rc 143\n");
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toContain("A conflict retry is pending on ");
    const line = c.stderr.match(/ Run this: (.*)$/m)[1];
    expect(line).toContain(`pr-end-state.sh record ${REPO} ${s.branch} 77 ENG-123`);
    expect(line).not.toContain("TICKET");
    // Another pull request of the branch: the ticket in the state is #77's, so the command keeps the word TICKET.
    const other = check(s, 78);
    expect(other.stderr).toContain(`pr-end-state.sh record ${REPO} ${s.branch} 78 TICKET`);
    expect(other.stderr).not.toContain("ENG-123");
    const ran = spawnSync("bash", ["-c", line], { cwd: s.seat, env: s.env, encoding: "utf8", timeout: LONG });
    expect(ran.stderr).toBe("");
    expect(ran.stdout).toMatch(/^OWNED: /);
    expect(savedEntry(s).pending).toBe(1);
  } finally {
    cleanup(s);
  }
}, LONG);

// A filesystem that ignores case opens a tracked file of another case under the waiter's own names, so the
// tracked-file check matches names without case.
test("a tracked waiter file whose name differs only in case is the repository's too: nothing is armed and nothing recorded", () => {
  const s = makeSeat();
  try {
    const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: s.seat, env: s.env, input: "{}\n", encoding: "utf8" }).stdout.trim();
    expect(blob).toMatch(/^[0-9a-f]{40,}$/);
    // An index entry alone, so the control is the same on a filesystem that keeps case and on one that does not.
    expect(s.git("update-index", "--add", "--cacheinfo", `100644,${blob},.Catalyst/Branch-Waiter.JSON`).status).toBe(0);
    const a = armIn(s, s.seat);
    expect(a.stderr).toContain("a waiter file the repository tracks");
    expect(a.stdout).not.toContain("branch-waiter: armed ");
    const r = record(s);
    expect(r.status).toBe(9);
    expect(r.stdout).not.toContain("OWNED");
    expect(hasEndFile(s)).toBe(false);
    expect(waitPids(s.ref)).toEqual([]);
    // CONTROL: without that entry the same command arms and records.
    expect(s.git("update-index", "--force-remove", ".Catalyst/Branch-Waiter.JSON").status).toBe(0);
    expect(record(s).stdout).toMatch(/^OWNED: /);
  } finally {
    cleanup(s);
  }
}, LONG);

// After a create step recorded NEEDS ATTENTION, check gives the reason on record and the command that
// records an owner once the reason is dealt with, with the ticket on record when there is one.
test("after a recorded NEEDS ATTENTION, check gives the reason and a record command that runs", () => {
  const s = makeSeat();
  const bare = makeSeat();
  try {
    expect(record(s, 77, "ENG-123", { STATUS_RC: "4" }).stdout).toMatch(/^NEEDS ATTENTION: /);
    const c = check(s);
    expect(c.status).toBe(9);
    expect(c.stderr).toContain("catalyst events status failed");
    const line = c.stderr.match(/Once that is dealt with, run this: (.*)$/m)[1];
    expect(line).toContain(`pr-end-state.sh record ${REPO} ${s.branch} 77 ENG-123`);
    const ran = spawnSync("bash", ["-c", line], { cwd: s.seat, env: s.env, encoding: "utf8", timeout: LONG });
    expect(ran.stderr).toBe("");
    expect(ran.stdout).toMatch(/^OWNED: /);
    expect(check(s).status).toBe(0);
    // With no ticket on record or in the waiter's state, the command keeps the word TICKET.
    expect(record(bare, 77, "").stdout).toMatch(/^NEEDS ATTENTION: /);
    const none = check(bare);
    expect(none.status).toBe(9);
    expect(none.stderr).toMatch(/Once that is dealt with, run this, with the ticket key in place of TICKET: bash .*pr-end-state\.sh record /);
    expect(none.stderr).toContain(`pr-end-state.sh record ${REPO} ${bare.branch} 77 TICKET`);
  } finally {
    cleanup(s);
    cleanup(bare);
  }
}, LONG);

// The reader's start time is read in one time zone and locale, so a check run in another shell names the
// same process. A record an older copy of this script made holds the reading of its own shell; that counts too.
test("a reader recorded in one time zone is the same reader for a check run in another", () => {
  const s = makeSeat();
  const end = join(s.seat, ".catalyst/create-pr-end.json");
  const key = `${s.ref}#77`;
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    expect(check(s, 77, { TZ: "Asia/Kolkata" }).stdout).toMatch(/^OWNED: /);
    expect(check(s, 77, { TZ: "America/Los_Angeles", LC_ALL: "C" }).status).toBe(0);
    const rec = JSON.parse(readFileSync(end, "utf8"));
    const local = spawnSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { env: { ...s.env, TZ: "Asia/Kolkata" }, encoding: "utf8" }).stdout.trim().replace(/\s+/g, " ");
    expect(local).not.toBe("");
    rec[key].owner.started = local;
    writeFileSync(end, JSON.stringify(rec));
    expect(check(s, 77, { TZ: "Asia/Kolkata" }).status).toBe(0);
    // CONTROL: a start time that is neither reading is another process, so the reader has ended.
    rec[key].owner.started = "Thu Jan 1 00:00:00 1970";
    writeFileSync(end, JSON.stringify(rec));
    const c = check(s, 77);
    expect(c.status).toBe(9);
    expect(c.stderr).toContain("has ended");
  } finally {
    cleanup(s);
  }
}, LONG);

// WAITER_AFTER, WAITER_PENDING and WAITER_DUE are what a wake handler hands to the arm it calls. Left in the
// environment of record, they are nobody's checkpoint.
test("a checkpoint left in the environment is not record's: the wait starts from the head of the event stream and no retry is saved", () => {
  const s = makeSeat();
  const wait = "catalyst events wait-for --ticket ENG-123 --after 100 --timeout 60";
  try {
    const r = record(s, 77, "ENG-123", { WAITER_AFTER: "999", WAITER_PENDING: "2", WAITER_DUE: "5" });
    expect(r.stdout).toMatch(/^OWNED: /);
    expect(callLinesWith(s, wait)).toContain(wait);
    expect(callLines(s).some((l) => l.includes("--after 999 "))).toBe(false);
    expect(savedEntry(s)).toEqual({ pr: 77, ticket: "ENG-123", cursor: 100 });
    // CONTROL: the published arm, called as a handler calls it, does start from the sequence it is handed.
    stopWaits(s.ref);
    writeFileSync(s.calls, "");
    expect(armIn(s, s.seat, s.branch, "ENG-123", { WAITER_AFTER: "999" }).stdout).toContain("branch-waiter: armed ");
    waitTimeouts(s);
    expect(callLines(s).some((l) => l.includes("--after 999 "))).toBe(true);
  } finally {
    cleanup(s);
  }
}, LONG);

// The log an older copy of the waiter wrote has the branch's slug alone in its name and no first line of its
// own. It is still read by check and by the handler given its path, and an arm and a stop remove it.
test("the log an older copy of the waiter wrote is still read by check, handled by the handler and removed by the stop", () => {
  const s = makeSeat();
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    // What an older copy left: its log under the older name, and none under the new one.
    rmSync(waiterLog(s));
    writeFileSync(oldWaiterLog(s), "cursor 140\nwaiter-rc 124\n");
    expect(check(s).stderr).toMatch(/is not running \(waiter-rc 124\)\. Handle its wake and arm it again/);
    writeFileSync(s.calls, "");
    const h = runBlocks(s, `handle_waiter_wake "$0" "$1" ".catalyst/waiter.$1.log"`);
    expect(h.stdout).toContain(`branch-waiter: armed ${s.ref} after 140 `);
    expect(h.stdout).toContain(`log .catalyst/${logNameOf(s.branch)}`);
    // The new arm's log has the new name, and the older one gave way to it.
    expect(named(oldWaiterLog(s))).toBe(false);
    expect(readFileSync(waiterLog(s), "utf8").startsWith(armLine(s.branch, { after: 140 }))).toBe(true);
    expect(check(s).stdout).toMatch(/^OWNED: /);
    // A stop removes an older log with the new one.
    writeFileSync(oldWaiterLog(s), "cursor 100\nwaiter-rc 124\n");
    const pids = waitPids(s.ref);
    expect(runBlocks(s, `stop_branch_waiter "$0" "$1" 77`, { PR_STATE: "merged" }).status).toBe(0);
    for (const pid of pids) expect(gone(pid)).toBe(true);
    expect(named(oldWaiterLog(s))).toBe(false);
    expect(named(waiterLog(s))).toBe(false);
  } finally {
    cleanup(s);
  }
}, LONG);

// An older copy gave one log to two branches whose names differ only in characters the slug drops. Whose wake
// such a log holds cannot be told, so the handler handles it for neither. Each branch's own log is handled
// for that branch alone.
test("an older log that two branches share is handled for neither, and each branch's own log only for it", () => {
  const base = freshBranch();
  const s = makeSeat({ branch: `${base}/api` });
  const twin = `${base}-api`;
  const state = join(s.seat, ".catalyst/branch-waiter.json");
  const handle = (branch, log) => runBlocks(s, `handle_waiter_wake "$0" '${branch}' '.catalyst/${log}'`);
  const oldName = `waiter.${slugOf(s.branch)}.log`;
  // An arm returns before its wait is sure to show in the process table.
  const seen = (ref) => { for (let i = 0; i < 50 && waitPids(ref).length === 0; i++) spawnSync("sleep", ["0.1"]); return waitPids(ref).length; };
  try {
    expect(slugOf(twin)).toBe(slugOf(s.branch));
    expect(record(s).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    rmSync(waiterLog(s));
    // What an older copy left: both branches in the state, and the one log they shared.
    const st = JSON.parse(readFileSync(state, "utf8"));
    const both = { ...st, [refOf(twin)]: { pr: 78, ticket: "ENG-456", cursor: 100 } };
    writeFileSync(state, JSON.stringify(both));
    writeFileSync(oldWaiterLog(s), "cursor 140\nwaiter-rc 124\n");
    for (const branch of [s.branch, twin]) {
      const h = handle(branch, oldName);
      expect(h.stderr).toContain("is the older log name of more than one branch");
      expect(h.stdout).not.toContain("branch-waiter: armed ");
      expect(waitPids(refOf(branch))).toEqual([]);
    }
    expect(JSON.parse(readFileSync(state, "utf8"))).toEqual(both);
    expect(readFileSync(oldWaiterLog(s), "utf8")).toBe("cursor 140\nwaiter-rc 124\n");
    // CONTROL: with this branch alone under the older name, the same log is handled as it always was.
    writeFileSync(state, JSON.stringify(st));
    const alone = handle(s.branch, oldName);
    expect(alone.stdout).toContain(`branch-waiter: armed ${s.ref} after 140 `);
    expect(named(oldWaiterLog(s))).toBe(false);
    expect(seen(s.ref)).toBeGreaterThan(0);
    stopWaits(s.ref);
    // Each branch's own log, with both in the state again: a handler given the other's log does nothing,
    // and each handles its own and arms from the sequence its own log reached.
    writeFileSync(state, JSON.stringify({ ...JSON.parse(readFileSync(state, "utf8")), [refOf(twin)]: both[refOf(twin)] }));
    writeFileSync(waiterLog(s), `${armLine(s.branch, { after: 140 })}cursor 160\nwaiter-rc 124\n`);
    writeFileSync(join(s.seat, ".catalyst", logNameOf(twin)), `${armLine(twin, { pr: 78, ticket: "ENG-456" })}cursor 150\nwaiter-rc 124\n`);
    const crossed = handle(s.branch, logNameOf(twin));
    expect(crossed.stderr).toContain("is the log of another branch's wait");
    expect(crossed.stdout).not.toContain("branch-waiter: armed ");
    expect(handle(s.branch, logNameOf(s.branch)).stdout).toContain(`branch-waiter: armed ${s.ref} after 160 `);
    expect(handle(twin, logNameOf(twin)).stdout).toContain(`branch-waiter: armed ${refOf(twin)} after 150 `);
    expect(seen(s.ref)).toBeGreaterThan(0);
    expect(seen(refOf(twin))).toBeGreaterThan(0);
  } finally {
    stopWaits(refOf(twin));
    cleanup(s);
  }
}, LONG);

// An older log names no pull request. When an arm saves its state for another pull request and its new log
// cannot take its name, the older log would be read as the exit of the pull request the state names now. The
// arm records in the state, in the write that names the new pull request, which one left that log. Nothing
// has to be removed for that, so a removal that fails changes nothing: FAIL_RM_NAME refuses it here.
test("an older log left by one pull request is not read for the next when the new arm's log cannot take its name and the older log cannot be removed", () => {
  const s = makeSeat();
  const both = { FAIL_LOG_MV: "1", FAIL_RM_NAME: `waiter.${slugOf(s.branch)}.log` };
  const armFor = (pr) => runBlocks(s, `arm_branch_waiter "$0" "$1" ${pr} ENG-123`, both);
  try {
    expect(record(s).stdout).toMatch(/^OWNED: /);
    stopWaits(s.ref);
    // What an older copy left for #77: a failed wait's log under the older name, and none under the new one.
    rmSync(waiterLog(s));
    writeFileSync(oldWaiterLog(s), "it broke\nwaiter-rc 3\n");
    expect(check(s).stderr).toMatch(/\(waiter-rc 3\)\. Stop and report it/);
    // CONTROL: an arm for the same pull request whose log cannot take its name leaves the older log, records
    // nothing about it, and its exit is still that pull request's.
    const same = armFor(77);
    expect(same.stderr).toContain("cannot create the log for ");
    expect(savedEntry(s).pr).toBe(77);
    expect(savedEntry(s).oldlog).toBeUndefined();
    expect(readFileSync(oldWaiterLog(s), "utf8")).toBe("it broke\nwaiter-rc 3\n");
    expect(check(s).stderr).toMatch(/\(waiter-rc 3\)\. Stop and report it/);
    // An arm for #78 saves its state, its log cannot take its name, and the older log cannot be removed.
    const refused = armFor(78);
    expect(refused.stderr).toContain("cannot create the log for ");
    expect(refused.stdout).not.toContain("branch-waiter: armed ");
    expect(waitPids(s.ref)).toEqual([]);
    expect(savedEntry(s).pr).toBe(78);
    expect(named(waiterLog(s))).toBe(false);
    expect(readFileSync(oldWaiterLog(s), "utf8")).toBe("it broke\nwaiter-rc 3\n");
    // The older log is still there and still #77's: its failed exit is not #78's.
    expect(check(s, 78).stderr).not.toContain("waiter-rc 3");
    expect(savedEntry(s).oldlog).toBe(77);
    // Armed for #77 again, the same way, it is #77's failed exit again.
    expect(armFor(77).stderr).toContain("cannot create the log for ");
    expect(savedEntry(s)).toMatchObject({ pr: 77, oldlog: 77 });
    expect(check(s).stderr).toMatch(/\(waiter-rc 3\)\. Stop and report it/);
    // And for #78 once more: not #78's, and the next record arms #78 and the older log gives way.
    expect(armFor(78).stderr).toContain("cannot create the log for ");
    expect(savedEntry(s)).toMatchObject({ pr: 78, oldlog: 77 });
    expect(check(s, 78).stderr).not.toContain("waiter-rc 3");
    expect(record(s, 78).stdout).toMatch(/^OWNED: /);
    expect(readFileSync(waiterLog(s), "utf8").startsWith(armLine(s.branch, { pr: 78 }))).toBe(true);
    expect(named(oldWaiterLog(s))).toBe(false);
  } finally {
    cleanup(s);
  }
}, LONG);

// Git refuses a checkout whose files belong to another user. That is not "no checkout here", and the line
// says which, so its reader knows what to change.
test("a checkout Git refuses to read for its owner is named as that, not as no checkout", () => {
  const s = makeSeat({ gitShim: true });
  try {
    const c = check(s, 77, { DUBIOUS: "1" });
    expect(c.status).toBe(9);
    expect(c.stderr).toContain("Git refuses to read this checkout");
    expect(c.stderr).toContain("dubious ownership");
    expect(c.stderr).not.toContain("not in a git checkout");
    expect(hasEndFile(s)).toBe(false);
    // CONTROL: the same seat without the refusal is read.
    expect(check(s).stderr).toContain("has no waiter and no handoff on record");
  } finally {
    cleanup(s);
  }
}, LONG);

// Every command reads with jq. Without it each one says so, where it used to print the shell's own
// "command not found" and, from check, advice to run a record that could not work either.
test("with no jq on PATH each command says so and reads and records nothing", () => {
  const s = makeSeat();
  try {
    const where = (name) => spawnSync("bash", ["-c", `command -v ${name}`], { env: s.env, encoding: "utf8" }).stdout.trim();
    const bash = where("bash");
    const dirname = where("dirname");
    expect(bash).toMatch(/^\//);
    expect(dirname).toMatch(/^\//);
    // A PATH with the one tool the script needs before it looks for jq.
    const only = join(s.dir, "only");
    mkdirSync(only);
    symlinkSync(dirname, join(only, "dirname"));
    for (const args of [["check", REPO, s.branch, "77"], ["record", REPO, s.branch, "77", "ENG-123"], ["handoff", REPO, s.branch, "77", "ticket:ENG-123", "msg_01", "next-turn"]]) {
      const r = spawnSync(bash, [script, ...args], { cwd: s.seat, env: { ...s.env, PATH: only }, encoding: "utf8", timeout: LONG });
      expect(r.status).toBe(9);
      expect(r.stderr).toContain("jq is not on PATH");
      expect(r.stdout).toBe("");
    }
    expect(hasEndFile(s)).toBe(false);
    expect(waitPids(s.ref)).toEqual([]);
  } finally {
    cleanup(s);
  }
}, LONG);

// The directory of a Git under test is first on PATH. A control for a machine with no `catalyst` CLI must
// not find one there either.
test("the directory of a Git under test goes through the no-CLI filter like the system directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "create-pr-end-path-"));
  try {
    const build = join(dir, "build");
    mkdirSync(build);
    writeFileSync(join(build, "git"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(build, "catalyst"), "#!/bin/sh\n", { mode: 0o755 });
    const [first] = systemPath(dir, true, [build, ...SYSTEM_DIRS]).split(":");
    expect(first).not.toBe(build);
    expect(existsSync(join(first, "git"))).toBe(true);
    expect(existsSync(join(first, "catalyst"))).toBe(false);
    // CONTROL: with the CLI wanted, the directory is used as it is.
    expect(systemPath(dir, false, [build, ...SYSTEM_DIRS]).split(":")[0]).toBe(build);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
