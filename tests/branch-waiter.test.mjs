// branch-waiter.test.mjs — a seat keeps one waiter on each branch it owns (CTC-5521).
//
// Run: bun test tests/branch-waiter.test.mjs
//
// The executable seam is the published Bash in vendor-src/references/branch-waiter.md itself,
// never a test-only reimplementation: every lifecycle control extracts a named fenced block and
// runs it against mock `catalyst`/`gh`/`mergify` binaries (the runExample pattern of
// tests/pr-cloud-events.test.mjs), with real `nohup`/`pgrep`/`kill` against a stub `catalyst`
// that sleeps or exits immediately on a scripted event. The conflict wake runs against a real
// throwaway git remote so the guarded push helper (draft-pr.sh) is exercised for real.

import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../", import.meta.url);
const root = fileURLToPath(rootUrl);
const reference = "vendor-src/references/branch-waiter.md";

function referenceText() {
  return readFileSync(new URL(reference, rootUrl), "utf8");
}

function bashBlocks(text) {
  return [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
}

function blockContaining(needle) {
  const found = bashBlocks(referenceText()).find((b) => b.includes(needle));
  if (!found) throw new Error(`no bash block in ${reference} contains "${needle}"`);
  return found;
}

const armBlock = () => blockContaining("arm_branch_waiter() {");
const wakeBlock = () => blockContaining("handle_waiter_wake() {");
const stopBlock = () => blockContaining("stop_branch_waiter() {");

const CONFLICT_EVENT = (sequence, branch, base = "main") =>
  JSON.stringify({ sequence, type: "pr.conflict.detected", payload: { repo: "coalesce-labs/example", branch, pr: 9001, base, headSha: "9f2c", ticket: "ENG-123" } });
// The documented comms.message.posted shape (no branch, no payload.repo, no payload.ticket):
// payload keys {message_id, kind, to, from}; the ticket rides in entity.id and to.ticket.
const MESSAGE_EVENT = (sequence) =>
  JSON.stringify({ sequence, type: "comms.message.posted", entity: { type: "ticket", id: "ENG-123" }, payload: { message_id: "msg_01", kind: "note", to: { ticket: "ENG-123" }, from: { kind: "person", id: "user_1", label: "user:user_1" } } });

// runWaiter — one mock environment per control. `code` is the composed script; mocks live on
// PATH, calls land in $CALL_LOG, and a real throwaway git fixture is built when asked.
function runWaiter(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "branch-waiter-"));
  const bin = join(dir, "bin");
  const log = join(dir, "calls");
  mkdirSync(bin);
  const script = (name, body) => writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  if (!options.absent) {
    script("catalyst", `echo "catalyst $*" >> "$CALL_LOG"
case "$1 $2" in
  "events status")
    [ "\${STATUS_RC:-0}" = 0 ] || exit "$STATUS_RC"
    echo "$STATUS_JSON"; exit 0 ;;
  "messages read")
    printf '%s\\n' "$MESSAGE_BODY"; exit 0 ;;
esac
if [ -n "\${WAIT_SLEEP:-}" ] && [ "$WAIT_SLEEP" != 0 ]; then
  trap 'touch "$STUB_EXITED_FILE"; exit 0' TERM
  sleep "$WAIT_SLEEP" & wait $!
  exit 0
fi
# The documented filter rule: values of one flag are OR'ed, different flags are AND'ed.
# A wait that cannot match emits nothing and times out (124) unless WAIT_RC scripts a code.
emit=1
types=""; tick=""; refs=""
while [ $# -gt 0 ]; do
  case "$1" in
    --type) types="$types $2"; shift 2 ;;
    --ticket) tick="$2"; shift 2 ;;
    --ref) refs="$refs $2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -n "\${WAIT_EVENT_JSON:-}" ]; then
  if [ -n "$types" ]; then
    et=$(printf '%s' "$WAIT_EVENT_JSON" | jq -r '.type // empty')
    case " $types " in *" $et "*) ;; *) emit=0 ;; esac
  fi
  if [ -n "$tick" ]; then
    etk=$(printf '%s' "$WAIT_EVENT_JSON" | jq -r 'if .entity.type? == "ticket" and .entity.id? != null then .entity.id elif .payload.to.ticket? != null then .payload.to.ticket else (.payload.ticket // empty) end')
    case "$tick" in "$etk") ;; *) emit=0 ;; esac
  fi
  if [ -n "$refs" ]; then
    erb="$(printf '%s' "$WAIT_EVENT_JSON" | jq -r '.payload.repo // empty'):$(printf '%s' "$WAIT_EVENT_JSON" | jq -r '.payload.branch // empty')"
    case " $refs " in *" $erb "*) ;; *) emit=0 ;; esac
  fi
fi
if [ "$emit" = 1 ] && [ -n "\${WAIT_EVENT_JSON:-}" ]; then
  printf '%s\\n' "$WAIT_EVENT_JSON"
  # A filtered wait (the branch waiter's) also prints its cursor line; an unfiltered
  # lifecycle watch consumes the bare event stream (monitoring-loop.md).
  if [ -n "$tick" ] || [ -n "$refs" ]; then echo "cursor \${WAIT_CURSOR:-41}"; fi
  exit "\${WAIT_RC:-0}"
fi
exit "\${WAIT_RC:-124}"`);
  }
  script("gh", `echo "gh $*" >> "$CALL_LOG"
if [ "$1" = repo ]; then echo "${options.repo ?? "coalesce-labs/example"}"; exit 0; fi
if [ "$1" = api ] && [[ "$2" == */pulls/* ]]; then
  if [ "$3" = --jq ] && [ "$4" = .base.ref ]; then echo "$PR_BASE"; exit 0; fi
  if [ "$3" = --jq ] && [ "$4" = .merged ]; then echo "$PR_MERGED"; exit 0; fi
  if [ "\${GH_STATIC:-0}" = 1 ]; then
    printf '{"base":{"ref":"%s"},"merged":%s,"state":"%s","head":{"sha":"head-1"}}\\n' "$PR_BASE" "$PR_MERGED" "$PR_STATE"; exit 0
  fi
  n=$(cat "$READ_COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$READ_COUNT"
  merged=false; [ "$n" -lt "\${MERGE_ON_READ:-2}" ] || merged=true
  printf '{"base":{"ref":"%s"},"merged":%s,"state":"%s","head":{"sha":"head-1"}}\\n' "$PR_BASE" "$merged" "\${PR_STATE:-open}"
  exit 0
fi
exit 0`);
  script("mergify", 'echo "mergify $*" >> "$CALL_LOG"');

  let cwd = dir;
  const fixture = options.gitFixture
    ? makeGitFixture(dir, options.gitFixture, options.gitBranch, options.fixtureOpts ?? {})
    : null;
  if (fixture) cwd = fixture.seat;

  try {
    const result = spawnSync("bash", ["-c", options.code], {
      cwd,
      env: {
        PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`, HOME: join(dir, "home"), CALL_LOG: log,
        READ_COUNT: join(dir, "reads"), STUB_EXITED_FILE: join(dir, "stub-exited"),
        STATUS_JSON: JSON.stringify(options.status ?? { head: 40, reachable: true }),
        STATUS_RC: String(options.statusRc ?? 0), WAIT_EVENT_JSON: options.waitEvent ?? "",
        WAIT_CURSOR: String(options.waitCursor ?? 41), WAIT_RC: String(options.waitRc ?? 0),
        WAIT_SLEEP: String(options.waitSleep ?? 0), MESSAGE_BODY: options.messageBody ?? "noted; verified against the code.",
        PR_BASE: options.prBase ?? "main", PR_MERGED: String(options.prMerged ?? false),
        PR_STATE: options.prState ?? "open", MERGE_ON_READ: String(options.mergeOnRead ?? 2),
        GH_STATIC: String(options.ghStatic ? 1 : 0),
        pr_number: "123", ticket: "ENG-123",
        CLAUDE_SKILL_DIR: options.skillDir ?? join(root, "skills", "create-pr"),
        GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Seat", GIT_AUTHOR_EMAIL: "seat@catalyst.test",
        GIT_COMMITTER_NAME: "Seat", GIT_COMMITTER_EMAIL: "seat@catalyst.test",
      },
      encoding: "utf8", timeout: 20000,
    });
    const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
    return { ...result, calls, dir, cwd, fixture };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

// A bare remote plus a seat clone on `branch` with one published commit, and a robot commit that
// moved main — the push-replay.test.sh fixture shape, minimal for the conflict wake. With
// `conflictMain`, the robot and the seat both edit shared.txt so the base merge conflicts; with
// `trailer`, the seat's commit carries a Mergify Change-Id (a stack branch).
function makeGitFixture(dir, name, branch, opts) {
  const d = join(dir, name);
  mkdirSync(d, { recursive: true });
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: join(dir, "home"), GIT_AUTHOR_NAME: "Seat", GIT_AUTHOR_EMAIL: "seat@catalyst.test", GIT_COMMITTER_NAME: "Seat", GIT_COMMITTER_EMAIL: "seat@catalyst.test" };
  const git = (args, cwdArg = d) => {
    const r = spawnSync("git", args, { cwd: cwdArg, env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  };
  git(["init", "-q", "--bare", "-b", "main", "remote.git"]);
  git(["clone", "-q", "remote.git", "seat"]);
  const seat = join(d, "seat");
  const commit = (repo, file, line, subject, trailer) => {
    writeFileSync(join(repo, file), `${line}\n`);
    git(["add", file], repo);
    if (trailer) git(["commit", "-q", "-m", subject, "-m", trailer], repo);
    else git(["commit", "-q", "-m", subject], repo);
  };
  commit(seat, "README.md", "base", "chore: base");
  git(["push", "-q", "origin", "main"], seat);
  git(["checkout", "-q", "-b", branch], seat);
  if (opts.conflictMain) commit(seat, "shared.txt", "seat edit", "feat: seat edits the shared line", opts.trailer);
  else commit(seat, "seat-a.txt", "a", "feat: published work", opts.trailer);
  git(["push", "-q", "-u", "origin", branch], seat);
  git(["clone", "-q", "remote.git", "robot"]);
  const robot = join(d, "robot");
  if (opts.conflictMain) commit(robot, "shared.txt", "robot edit", "fix: robot edits the shared line");
  else commit(robot, "main-only.txt", "m", "feat: main moves on");
  git(["push", "-q", "origin", "main"], robot);
  git(["fetch", "-q", "origin"], seat);
  return { dir: d, seat, robot, remote: join(d, "remote.git") };
}

const callsFile = (result) => join(result.dir, "calls");
const callsNow = (result) => (existsSync(callsFile(result)) ? readFileSync(callsFile(result), "utf8").trim().split("\n").filter(Boolean) : []);
const waits = (calls) => calls.filter((call) => call.startsWith("catalyst events wait-for "));
const waiterWaits = (calls) => waits(calls).filter((call) => call.includes("--type pr.conflict.detected"));
const armCall = (branch) => `arm_branch_waiter "coalesce-labs/example" "${branch}" 9001 "ENG-123"`;
const fullWait = (after) =>
  `catalyst events wait-for --type pr.conflict.detected --type comms.message.posted --ticket ENG-123 --after ${after} --timeout 4h`;
const statePath = (result) => join(result.cwd, ".catalyst", "branch-waiter.json");
const waiterLogPath = (result, branch) => join(result.cwd, ".catalyst", `waiter.${branch.replace(/[^A-Za-z0-9._-]/g, "-")}.log`);
const killWaiters = (branch) => {
  // The "--" separator matters: a pattern beginning with "--ref" parses as a long option and
  // pkill exits 2 without killing anything, leaking sleepers into later runs.
  spawnSync("pkill", ["-f", "--", `wait-for .* coalesce-labs/example:${branch} `], { stdio: "ignore" });
};
const waitFor = (predicate, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return predicate();
};
const settleWaiterWaits = (result, n = 1) => waitFor(() => waiterWaits(callsNow(result)).length >= n);
const writeWaiterState = (ref, pr, cursor) =>
  `printf '%s\\n' '${JSON.stringify({ [ref]: { pr, ticket: "ENG-123", cursor } })}' > .catalyst/branch-waiter.json`;

// ─── Phase 1: the reference and its lifecycle controls ───────────────────────────────────────

test("the shared reference exists within the line budget and names every required fact", () => {
  const text = referenceText();
  expect(text.split("\n").length).toBeLessThanOrEqual(150);
  for (const phrase of ["does not promise", "next turn boundary", "Monitor", "event in", "herdr", "not an instruction"]) {
    expect(text).toContain(phrase);
  }
});

test("arm: the snippet starts exactly one ticket-scoped wait carrying both types", () => {
  const result = runWaiter({
    waitEvent: CONFLICT_EVENT(41, "fix-replica-a"), waitCursor: 41,
    code: `${armBlock()}\n${armCall("fix-replica-a")}`,
  });
  try {
    expect(result.status).toBe(0);
    expect(settleWaiterWaits(result)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(40)]);
    expect(result.stdout).toContain("armed coalesce-labs/example:fix-replica-a after 40");
    const state = JSON.parse(readFileSync(statePath(result), "utf8"));
    expect(state["coalesce-labs/example:fix-replica-a"]).toEqual({ pr: 9001, ticket: "ENG-123", cursor: 40 });
    expect(waitFor(() => existsSync(waiterLogPath(result, "fix-replica-a")) && readFileSync(waiterLogPath(result, "fix-replica-a"), "utf8").includes("waiter-rc 0"))).toBe(true);
  } finally {
    killWaiters("fix-replica-a");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("idempotent: a second arm while the waiter lives starts no second wait", () => {
  const result = runWaiter({
    waitSleep: 30,
    code: `${armBlock()}\n${armCall("fix-replica-i")}\n${armCall("fix-replica-i")}`,
  });
  try {
    expect(result.status).toBe(0);
    expect(settleWaiterWaits(result)).toBe(true);
    expect(waiterWaits(callsNow(result))).toHaveLength(1);
    const already = result.stdout.trim().split("\n").filter((line) => line.includes("already running"));
    expect(already).toHaveLength(1);
  } finally {
    killWaiters("fix-replica-i");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("conflict wake: REST base ref, --no-ff merge, guarded push, re-arm from the printed cursor", () => {
  const result = runWaiter({
    gitFixture: "conflict", gitBranch: "fix-replica-c",
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995801, "fix-replica-c")}'; echo 'cursor 995801'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-c.log
${writeWaiterState("coalesce-labs/example:fix-replica-c", 9001, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-c" ".catalyst/waiter.fix-replica-c.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.calls).toContain("gh api repos/coalesce-labs/example/pulls/9001 --jq .base.ref");
    expect(settleWaiterWaits(result)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995801)]);
    // The merge commit landed locally and the guarded push made the remote tip equal HEAD.
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim();
    const parents = spawnSync("git", ["show", "-s", "--format=%P", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim().split(" ");
    expect(parents).toHaveLength(2); // --no-ff merge commit, never a rebase of the published branch
    const mainTip = spawnSync("git", ["rev-parse", "origin/main"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim();
    expect(parents).toContain(mainTip);
    const remoteTip = spawnSync("git", ["ls-remote", result.fixture.remote, "refs/heads/fix-replica-c"], { encoding: "utf8" }).stdout.split("\t")[0];
    expect(remoteTip).toBe(head);
    const state = JSON.parse(readFileSync(statePath(result), "utf8"));
    expect(state["coalesce-labs/example:fix-replica-c"].cursor).toBe(995801);
    expect(state["coalesce-labs/example:fix-replica-c"].ticket).toBe("ENG-123");
  } finally {
    killWaiters("fix-replica-c");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("conflict wake: a merge conflict aborts, reports paths, pushes nothing, still re-arms", () => {
  const result = runWaiter({
    gitFixture: "abort", gitBranch: "fix-replica-x", fixtureOpts: { conflictMain: true },
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995802, "fix-replica-x")}'; echo 'cursor 995802'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-x.log
${writeWaiterState("coalesce-labs/example:fix-replica-x", 9001, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-x" ".catalyst/waiter.fix-replica-x.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain("conflicts in: shared.txt");
    expect(settleWaiterWaits(result)).toBe(true);
    expect(spawnSync("git", ["rev-parse", "--verify", "-q", "MERGE_HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).status).not.toBe(0); // aborted
    const parents = spawnSync("git", ["show", "-s", "--format=%P", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim().split(" ");
    expect(parents).toHaveLength(1); // no merge commit: HEAD is still the published tip, so nothing was pushed
  } finally {
    killWaiters("fix-replica-x");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("conflict wake: a stack branch resyncs through mergify instead of merging", () => {
  const result = runWaiter({
    gitFixture: "stack", gitBranch: "fix-replica-k", fixtureOpts: { trailer: "Change-Id: I8f2c1" },
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995803, "fix-replica-k")}'; echo 'cursor 995803'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-k.log
${writeWaiterState("coalesce-labs/example:fix-replica-k", 9001, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-k" ".catalyst/waiter.fix-replica-k.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.calls).toContain("mergify stack sync");
    expect(result.calls).toContain("mergify stack push");
    const parents = spawnSync("git", ["show", "-s", "--format=%P", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim().split(" ");
    expect(parents).toHaveLength(1); // a stack branch is resynced, never merged
    expect(settleWaiterWaits(result)).toBe(true);
  } finally {
    killWaiters("fix-replica-k");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("wrong HEAD: a wake for branch-a while branch-b is checked out merges and pushes nothing", () => {
  const result = runWaiter({
    gitFixture: "wronghead", gitBranch: "fix-replica-h2",
    code: `${armBlock()}\n${wakeBlock()}
git checkout -q -b fix-replica-h1 && git push -q -u origin fix-replica-h1 && git checkout -q fix-replica-h2
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995804, "fix-replica-h1")}'; echo 'cursor 995804'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-h1.log
${writeWaiterState("coalesce-labs/example:fix-replica-h1", 9001, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-h1" ".catalyst/waiter.fix-replica-h1.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stderr + result.stdout).toContain("HEAD is fix-replica-h2, not fix-replica-h1");
    expect(result.calls.some((call) => call.startsWith("gh ") || call.startsWith("git merge") || call.startsWith("git push"))).toBe(false);
    const h1Tip = spawnSync("git", ["rev-parse", "fix-replica-h1"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim();
    const remoteH1 = spawnSync("git", ["ls-remote", result.fixture.remote, "refs/heads/fix-replica-h1"], { encoding: "utf8" }).stdout.split("\t")[0];
    expect(remoteH1).toBe(h1Tip); // branch-a untouched on the remote
    const parents = spawnSync("git", ["show", "-s", "--format=%P", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim().split(" ");
    expect(parents).toHaveLength(1); // nothing merged into the checked-out branch either
    expect(settleWaiterWaits(result)).toBe(true); // the waiter is still re-armed
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995804)]);
  } finally {
    killWaiters("fix-replica-h1");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("wrong branch in the event: a conflict for another branch of the same ticket is reported, not merged", () => {
  const result = runWaiter({
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995805, "fix-replica-other")}'; echo 'cursor 995805'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-o.log
${writeWaiterState("coalesce-labs/example:fix-replica-o", 9001, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-o" ".catalyst/waiter.fix-replica-o.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stderr + result.stdout).toContain("the conflict is on fix-replica-other, not coalesce-labs/example:fix-replica-o");
    expect(result.calls.some((call) => call.startsWith("gh ") || call.startsWith("git ") || call.startsWith("mergify "))).toBe(false);
    expect(settleWaiterWaits(result)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995805)]);
  } finally {
    killWaiters("fix-replica-o");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("message wake: own-key read with the ticket from entity.id, body echoed never executed, re-arm", () => {
  const result = runWaiter({
    messageBody: "touch pwned",
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${MESSAGE_EVENT(995802)}'; echo 'cursor 995802'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-m.log
handle_waiter_wake "coalesce-labs/example" "fix-replica-m" ".catalyst/waiter.fix-replica-m.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.calls).toContain("catalyst messages read --ticket ENG-123 --since 995802");
    expect(result.stdout).toContain("touch pwned"); // printed as evidence…
    expect(existsSync(join(result.cwd, "pwned"))).toBe(false); // …never executed
    expect(settleWaiterWaits(result)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995802)]);
    expect(result.calls.some((call) => call.startsWith("gh ") || call.startsWith("git ") || call.startsWith("mergify "))).toBe(false);
  } finally {
    killWaiters("fix-replica-m");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("message wake is reachable: a real-shaped message event wakes the armed waiter itself", () => {
  const result = runWaiter({
    waitEvent: MESSAGE_EVENT(995802), waitCursor: 995802,
    code: `${armBlock()}\n${wakeBlock()}\n${armCall("fix-replica-w")}
sleep 1
handle_waiter_wake "coalesce-labs/example" "fix-replica-w" ".catalyst/waiter.fix-replica-w.log"`,
  });
  try {
    expect(result.status).toBe(0);
    // The wait the arm started actually matched the message event (a --ref-filtered wait
    // never can: message events carry no branch), and the handler read the body with it.
    expect(waiterWaits(result.calls)[0]).toBe(fullWait(40));
    expect(result.calls).toContain("catalyst messages read --ticket ENG-123 --since 995802");
    expect(result.stdout).toContain("noted; verified against the code.");
    expect(settleWaiterWaits(result, 2)).toBe(true);
  } finally {
    killWaiters("fix-replica-w");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("timeout: exit 124 re-arms from the same cursor with zero gh/git calls", () => {
  const result = runWaiter({
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
echo 'waiter-rc 124' > .catalyst/waiter.fix-replica-t.log
${writeWaiterState("coalesce-labs/example:fix-replica-t", 9001, 40)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-t" ".catalyst/waiter.fix-replica-t.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(settleWaiterWaits(result)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(40)]);
    expect(result.calls.some((call) => call.startsWith("gh ") || call.startsWith("git ") || call.startsWith("mergify ") || call.startsWith("catalyst messages"))).toBe(false);
  } finally {
    killWaiters("fix-replica-t");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("refusal: exit 3 reports the refusal and does not re-arm", () => {
  const result = runWaiter({
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
echo 'waiter-rc 3' > .catalyst/waiter.fix-replica-r.log
${writeWaiterState("coalesce-labs/example:fix-replica-r", 9001, 40)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-r" ".catalyst/waiter.fix-replica-r.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(waiterWaits(result.calls)).toHaveLength(0);
    expect(result.stdout.trim().split("\n").filter((line) => line.includes("refused"))).toHaveLength(1);
  } finally {
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("absent CLI: no wait started, exactly one reason line, exit 0", () => {
  const result = runWaiter({
    absent: true,
    code: `${armBlock()}\n${armCall("fix-replica-n")}`,
  });
  try {
    expect(result.status).toBe(0);
    expect(waits(result.calls)).toHaveLength(0);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain("absent");
    expect(existsSync(join(result.cwd, ".catalyst"))).toBe(false);
  } finally {
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("hostile branch name: the branch never reaches a parsed command string", () => {
  const result = runWaiter({
    waitSleep: 30,
    code: `${armBlock()}\n${armCall("fix;touch${IFS}INJECTED;#")}`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("armed coalesce-labs/example:fix;touch");
    // The wait is ticket-scoped; the branch bytes are not pasted into any parsed string.
    expect(settleWaiterWaits(result)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(40)]);
    expect(existsSync(join(result.cwd, "INJECTED"))).toBe(false); // nothing executed the branch bytes
  } finally {
    spawnSync("pkill", ["-f", "--", "wait-for .* waiter[.]fix-touch"], { stdio: "ignore" });
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// ─── Phase 2: create-pr arms exactly one waiter per branch ───────────────────────────────────

test("create-pr SKILL.md arms the waiter as its last step", () => {
  const skill = readFileSync(new URL("skills/create-pr/SKILL.md", rootUrl), "utf8");
  expect(skill).toContain("Arm the branch waiter");
  expect(skill).toContain("assets/references/branch-waiter.md");
});

test("arm-after-monitor: the waiter is armed once the monitoring loop ends clean", () => {
  const monitoring = readFileSync(new URL("skills/create-pr/references/monitoring-loop.md", rootUrl), "utf8").match(/```bash\n([\s\S]*?)```/)[1];
  const result = runWaiter({
    waitEvent: JSON.stringify({ sequence: 41, type: "github.pr.merged" }),
    code: `${monitoring}\n${armBlock()}\narm_branch_waiter "coalesce-labs/example" "fix-replica" "$pr_number" "$ticket"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("MERGED");
    expect(settleWaiterWaits(result)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(40)]);
    const state = JSON.parse(readFileSync(statePath(result), "utf8"));
    expect(state["coalesce-labs/example:fix-replica"]).toEqual({ pr: 123, ticket: "ENG-123", cursor: 40 });
  } finally {
    killWaiters("fix-replica");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("outcomes: arming follows live outcomes; PENDING and a skipped existing PR arm nothing", () => {
  const doc = readFileSync(new URL("skills/create-pr/references/outcomes-and-errors.md", rootUrl), "utf8");
  expect(doc).toMatch(/clean or (a )?genuinely human-blocked outcome/i);
  expect(doc).toContain("branch-waiter.md");
  expect(doc).toMatch(/PENDING[^\n]*arms nothing/i);
  expect(doc).toMatch(/skip[^\n]*arms nothing/i);
  expect(doc).toMatch(/describe[^\n]*arm|arm[^\n]*describe/i);
});

// ─── Phase 3: merge-pr stops the waiter; both skills carry the same reference ────────────────

test("stop-on-merge: a REST-confirmed merge kills the waiter and clears its state", () => {
  const result = runWaiter({
    waitSleep: 30, prMerged: true, prState: "closed", ghStatic: true,
    code: `${armBlock()}\n${stopBlock()}\n${armCall("fix-replica-s1")}\nstop_branch_waiter "coalesce-labs/example" "fix-replica-s1" 9001`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("stopped the waiter on coalesce-labs/example:fix-replica-s1");
    expect(waitFor(() => existsSync(join(result.dir, "stub-exited")))).toBe(true); // the wait process was killed
    expect(existsSync(waiterLogPath(result, "fix-replica-s1"))).toBe(false); // the log is removed
    expect(JSON.parse(readFileSync(statePath(result), "utf8"))).toEqual({}); // the state entry is gone
  } finally {
    killWaiters("fix-replica-s1");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("stop-on-close: a closed PR tears the waiter down the same way", () => {
  const result = runWaiter({
    waitSleep: 30, prMerged: false, prState: "closed", ghStatic: true,
    code: `${armBlock()}\n${stopBlock()}\n${armCall("fix-replica-s2")}\nstop_branch_waiter "coalesce-labs/example" "fix-replica-s2" 9001`,
  });
  try {
    expect(result.status).toBe(0);
    expect(waitFor(() => existsSync(join(result.dir, "stub-exited")))).toBe(true);
    expect(JSON.parse(readFileSync(statePath(result), "utf8"))).toEqual({});
  } finally {
    killWaiters("fix-replica-s2");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("queued-only: an open, unmerged PR stops nothing", () => {
  const result = runWaiter({
    waitSleep: 30, prMerged: false, prState: "open", ghStatic: true,
    code: `${armBlock()}\n${stopBlock()}\n${armCall("fix-replica-q")}\nstop_branch_waiter "coalesce-labs/example" "fix-replica-q" 9001`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("stays");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
    expect(existsSync(join(result.dir, "stub-exited"))).toBe(false); // the waiter is still running
    expect(existsSync(waiterLogPath(result, "fix-replica-q"))).toBe(true);
    expect(JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-q"]).toBeDefined();
  } finally {
    killWaiters("fix-replica-q");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("merge-pr SKILL.md stops the waiter at the confirmed merge and not for a queued PR", () => {
  const skill = readFileSync(new URL("skills/merge-pr/SKILL.md", rootUrl), "utf8");
  expect(skill).toContain("assets/references/branch-waiter.md");
  expect(skill).toMatch(/[Ss]top the branch waiter/);
  expect(skill).toMatch(/queued PR is not merged and stops nothing/);
});

test("both skills carry the reference byte-identical, and merge-pr carries the guarded push helper", () => {
  const src = readFileSync(new URL("vendor-src/references/branch-waiter.md", rootUrl), "utf8");
  for (const skill of ["create-pr", "merge-pr"]) {
    expect(readFileSync(new URL(`skills/${skill}/assets/references/branch-waiter.md`, rootUrl), "utf8")).toBe(src);
  }
  const helper = readFileSync(new URL("skills/create-pr/scripts/lib/draft-pr.sh", rootUrl));
  expect(readFileSync(new URL("skills/merge-pr/scripts/lib/draft-pr.sh", rootUrl)).equals(helper)).toBe(true);
});

test("the pack version is bumped in lockstep", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", rootUrl), "utf8"));
  const plugin = JSON.parse(readFileSync(new URL(".claude-plugin/plugin.json", rootUrl), "utf8"));
  expect(pkg.version).toBe("15.0.1");
  expect(plugin.version).toBe(pkg.version);
});
