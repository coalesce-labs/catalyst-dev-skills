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
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
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

const CONFLICT_EVENT = (sequence, branch, base = "main", pr = 9001, repo = "coalesce-labs/example") =>
  JSON.stringify({ sequence, type: "pr.conflict.detected", entity: { type: "pull_request", id: `${repo}#${pr}` }, payload: { repo, branch, pr, base, headSha: "9f2c", mergeableState: "dirty", ticket: "ENG-123" } });
// A stack change's pull request has the tool's own head ref, and its conflict event carries
// that ref as payload.branch. The local branch name appears only inside it.
const STACK_REF = (branch) => `stack/seat/${branch}/published-work--8f2c1`;
// What `mergify stack list --json` prints: one entry per change, with its pull request number.
const stackList = (pulls, branch = "fix-replica-k") =>
  ({ branch, trunk: "origin/main", entries: pulls.map((pull_number, i) => ({ commit_sha: `c${i}`, change_id: `I8f2c${i + 1}`, status: "draft", pull_number })) });
const MERGIFY_LISTS_ITS_STACK = `echo "mergify $*" >> "$CALL_LOG"
if [ "$1 $2" = "stack list" ]; then printf '%s\\n' "$STACK_LIST_JSON"; fi`;
// The documented comms.message.posted shape (no branch, no payload.repo, no payload.ticket):
// payload keys {message_id, kind, to, from}; the ticket rides in entity.id and to.ticket.
const MESSAGE_EVENT = (sequence) =>
  JSON.stringify({ sequence, type: "comms.message.posted", entity: { type: "ticket", id: "ENG-123" }, payload: { message_id: "msg_01", kind: "note", to: { ticket: "ENG-123" }, from: { kind: "person", id: "user_1", label: "user:user_1" } } });

// The system tool directories a control runs with. A control for a machine with no `catalyst`
// CLI must not find one there either, so any directory that holds a `catalyst` is replaced by a
// shadow of it: a link to every other tool in it, and no `catalyst`.
const SYSTEM_DIRS = ["/usr/local/bin", "/usr/bin", "/bin"];
function systemPath(dir, systemDirs, withoutCatalyst) {
  if (!withoutCatalyst) return systemDirs.join(":");
  return systemDirs.map((d, i) => {
    if (!existsSync(join(d, "catalyst"))) return d;
    const shadow = join(dir, `tools-${i}`);
    mkdirSync(shadow);
    for (const name of readdirSync(d)) if (name !== "catalyst") symlinkSync(join(d, name), join(shadow, name));
    return shadow;
  }).join(":");
}

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
    # STATUS_FAIL_CALLS scripts that many failed status reads before one succeeds (exit 4, as the
    # released CLI answers an unreachable cloud); STATUS_RC makes every status read fail.
    sf=$(cat "$READ_COUNT.status" 2>/dev/null || echo 0)
    if [ "$sf" -lt "\${STATUS_FAIL_CALLS:-0}" ]; then echo $((sf + 1)) > "$READ_COUNT.status"; exit 4; fi
    [ "\${STATUS_RC:-0}" = 0 ] || exit "$STATUS_RC"
    echo "$STATUS_JSON"; exit 0 ;;
  "messages read")
    [ -z "\${MESSAGES_SLEEP:-}" ] || sleep "$MESSAGES_SLEEP" # a slow message read
    printf '%s\\n' "$MESSAGE_BODY"; exit 0 ;;
esac
if [ -n "\${WAIT_SLEEP:-}" ] && [ "$WAIT_SLEEP" != 0 ]; then
  trap 'touch "$STUB_EXITED_FILE"; exit 0' TERM
  sleep "$WAIT_SLEEP" & wait $!
  exit 0
fi
# The stand-in follows the released CLI, and tests/branch-waiter-cli.test.mjs holds it to that:
# --timeout is whole seconds and anything else is a usage error (exit 1); a second --type
# replaces the first; the wait prints the first event after --after that passes every filter
# and nothing else; a wait that ends with no event prints one line on stderr and exits 1.
type=""; tick=""; refs=""; after=0; secs=300
while [ $# -gt 0 ]; do
  case "$1" in
    --type) type="$2"; shift 2 ;;
    --ticket) tick="$2"; shift 2 ;;
    --ref) refs="$refs $2"; shift 2 ;;
    --after) after="$2"; shift 2 ;;
    --timeout) secs="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$secs" in ''|*[!0-9]*) echo "--timeout must be an integer" >&2; exit 1 ;; esac
if [ "\${WAIT_RC:-0}" != 0 ]; then
  [ -z "\${WAIT_ERR:-}" ] || echo "$WAIT_ERR" >&2
  exit "$WAIT_RC"
fi
while IFS= read -r ev; do
  [ -n "$ev" ] || continue
  [ "$(printf '%s' "$ev" | jq -r '.sequence // 0')" -gt "$after" ] || continue
  if [ -n "$type" ] && [ "$(printf '%s' "$ev" | jq -r '.type // empty')" != "$type" ]; then continue; fi
  if [ -n "$tick" ]; then
    etk=$(printf '%s' "$ev" | jq -r 'if .entity.type? == "ticket" and .entity.id? != null then .entity.id elif .payload.to.ticket? != null then .payload.to.ticket else (.payload.ticket // empty) end')
    [ "$tick" = "$etk" ] || continue
  fi
  if [ -n "$refs" ]; then
    erb="$(printf '%s' "$ev" | jq -r '.payload.repo // empty'):$(printf '%s' "$ev" | jq -r '.payload.branch // empty')"
    case " $refs " in *" $erb "*) ;; *) continue ;; esac
  fi
  printf '%s\\n' "$ev"
  exit 0
done <<WAIT_EVENTS_END
\${WAIT_EVENTS:-\${WAIT_EVENT_JSON:-}}
WAIT_EVENTS_END
echo "events: no matching event within $secs s" >&2
exit 1`);
  }
  script("gh", `echo "gh $*" >> "$CALL_LOG"
if [ "$1" = repo ]; then echo "${options.repo ?? "coalesce-labs/example"}"; exit 0; fi
if [ "$1" = api ] && [[ "$2" == */pulls/* ]]; then
  if [ "$3" = --jq ] && [ "$4" = .base.ref ]; then echo "$PR_BASE"; exit 0; fi
  # An ordinary pull request's head is the branch that is checked out; a stack change's is not.
  if [ "$3" = --jq ] && [ "$4" = '.base.ref + " " + .head.ref' ]; then
    # GH_FAIL_READS scripts that many failed reads of the pull request before one succeeds.
    [ -z "\${GH_SLEEP:-}" ] || sleep "$GH_SLEEP" # a slow read of the pull request
    failed=$(cat "$READ_COUNT.failed" 2>/dev/null || echo 0)
    if [ "$failed" -lt "\${GH_FAIL_READS:-0}" ]; then echo $((failed + 1)) > "$READ_COUNT.failed"; echo "gh: HTTP 502" >&2; exit 1; fi
    echo "$PR_BASE \${PR_HEAD:-$(git branch --show-current 2>/dev/null)}"; exit 0
  fi
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
  script("mergify", options.mergify ?? MERGIFY_LISTS_ITS_STACK);

  let cwd = dir;
  const fixture = options.gitFixture
    ? makeGitFixture(dir, options.gitFixture, options.gitBranch, options.fixtureOpts ?? {})
    : null;
  if (fixture) cwd = fixture.seat;

  try {
    const result = spawnSync("bash", ["-c", options.code], {
      cwd,
      env: {
        PATH: `${bin}:${systemPath(dir, options.systemDirs ?? SYSTEM_DIRS, options.absent === true)}`, HOME: join(dir, "home"), CALL_LOG: log,
        RAW_SYSTEM_PATH: (options.systemDirs ?? SYSTEM_DIRS).join(":"), GH_FAIL_READS: String(options.ghFailReads ?? 0),
        STATUS_FAIL_CALLS: String(options.statusFailCalls ?? 0),
        MESSAGES_SLEEP: String(options.messagesSleep ?? ""), GH_SLEEP: String(options.ghSleep ?? ""),
        READ_COUNT: join(dir, "reads"), STUB_EXITED_FILE: join(dir, "stub-exited"),
        STATUS_JSON: JSON.stringify(options.status ?? { head: 40, reachable: true }),
        STATUS_RC: String(options.statusRc ?? 0), WAIT_EVENT_JSON: options.waitEvent ?? "",
        WAIT_CURSOR: String(options.waitCursor ?? 41), WAIT_RC: String(options.waitRc ?? 0),
        WAIT_SLEEP: String(options.waitSleep ?? 0), MESSAGE_BODY: options.messageBody ?? "noted; verified against the code.",
        WAIT_EVENTS: (options.waitEvents ?? []).join("\n"), WAIT_ERR: options.waitErr ?? "",
        PR_HEAD: options.prHead ?? "", STACK_LIST_JSON: JSON.stringify(options.stackList ?? stackList([])),
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
// The branch waiter's wait is the ticket-scoped one with no type filter.
const waiterWaits = (calls) => waits(calls).filter((call) => call.includes("--ticket ENG-123") && !call.includes("--type"));
const armCall = (branch) => `arm_branch_waiter "coalesce-labs/example" "${branch}" 9001 "ENG-123"`;
const fullWait = (after, seconds = 14400) =>
  `catalyst events wait-for --ticket ENG-123 --after ${after} --timeout ${seconds}`;
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
// A state entry with a conflict pending, its next try due `dueIn` seconds from now (negative:
// already overdue). The script prints the time it wrote, and dueWritten reads it back.
const writePendingState = (ref, pending, dueIn) =>
  `due=$(( $(date +%s) + ${dueIn} )); echo "due $due"
jq -n --arg ref '${ref}' --argjson pending ${pending} --argjson due "$due" '{($ref): {pr: 9001, ticket: "ENG-123", cursor: 995788, pending: $pending, due: $due}}' > .catalyst/branch-waiter.json`;
// In these tests a retry wait ends at once. backdateDue sets a pending conflict's due time into
// the past, as if the wait had run its length, so the next wake is the retry.
const backdateDue = (ref) =>
  `jq --arg ref '${ref}' 'if .[$ref].pending then .[$ref].due = 1 else . end' .catalyst/branch-waiter.json > .catalyst/branch-waiter.backdate && mv .catalyst/branch-waiter.backdate .catalyst/branch-waiter.json`;
const dueWritten = (result) => Number(result.stdout.match(/^due (\d+)$/m)[1]);
const armedSeconds = (call) => Number(call.match(/--timeout (\d+)$/)[1]);
const writeWaiterState = (ref, pr, cursor) =>
  `printf '%s\\n' '${JSON.stringify({ [ref]: { pr, ticket: "ENG-123", cursor } })}' > .catalyst/branch-waiter.json`;

test("CTC-10679: the inbox check, not the waiter, is how a seat receives and acknowledges mail", () => {
  const text = referenceText();
  for (const phrase of ["catalyst inbox check", "catalyst inbox ack", "at seat start and at every turn boundary"]) {
    expect(text).toContain(phrase);
  }
});

// ─── Phase 1: the reference and its lifecycle controls ───────────────────────────────────────

test("the shared reference exists within the line budget and names every required fact", () => {
  const text = referenceText();
  expect(text.split("\n").length).toBeLessThanOrEqual(150);
  for (const phrase of ["does not promise", "next turn boundary", "Monitor", "event in", "herdr", "not an instruction"]) {
    expect(text).toContain(phrase);
  }
});

test("arm: the snippet starts exactly one ticket-scoped wait, in whole seconds and with no type filter", () => {
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
    expect(result.calls).toContain('gh api repos/coalesce-labs/example/pulls/9001 --jq .base.ref + " " + .head.ref');
    expect(result.calls.some((call) => call.startsWith("mergify "))).toBe(false); // an ordinary branch never reaches the stack tool
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

// The stand-in models the tool's documented default: a stack push rewrites the pull request's
// description from the commit message unless it is given the keep option.
const MERGIFY_REWRITES_DESCRIPTION = `${MERGIFY_LISTS_ITS_STACK}
if [ "$1 $2" = "stack push" ]; then
  case " $* " in
    *" --keep-pull-request-title-and-body "*|*" -k "*) ;;
    *) git log -1 --format=%B > "$PR_DESCRIPTION_FILE" ;;
  esac
fi`;

test("conflict wake: a stack resync keeps the description written on the pull request", () => {
  const written = "## Live proofs after deploy\n\n- the owner reads the first run after the deploy\n\n## Rollout\n\n- measured for one day\n";
  const result = runWaiter({
    gitFixture: "stack", gitBranch: "fix-replica-k", fixtureOpts: { trailer: "Change-Id: I8f2c1" },
    mergify: MERGIFY_REWRITES_DESCRIPTION, prHead: STACK_REF("fix-replica-k"), stackList: stackList([9001]),
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
export PR_DESCRIPTION_FILE="$PWD/.catalyst/pr-description"
printf '%b' '${written}' > "$PR_DESCRIPTION_FILE"
{ printf '%s\\n' '${CONFLICT_EVENT(995803, STACK_REF("fix-replica-k"))}'; echo 'cursor 995803'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-k.log
${writeWaiterState("coalesce-labs/example:fix-replica-k", 9001, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-k" ".catalyst/waiter.fix-replica-k.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.calls.some((call) => call.startsWith("mergify stack push"))).toBe(true);
    const after = readFileSync(join(result.fixture.seat, ".catalyst", "pr-description"), "utf8");
    expect(after).toBe(written.replaceAll("\\n", "\n"));
    expect(settleWaiterWaits(result)).toBe(true);
  } finally {
    killWaiters("fix-replica-k");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// The event of a stack change names the tool's head ref, never the local branch, so the handler
// cannot recognise its own pull request by branch name. It goes by the pull request it was armed for.
test("conflict wake: a change of this branch's stack resyncs through mergify, though the event names the tool's ref", () => {
  const result = runWaiter({
    gitFixture: "stack", gitBranch: "fix-replica-k", fixtureOpts: { trailer: "Change-Id: I8f2c1" },
    prHead: STACK_REF("fix-replica-k"), stackList: stackList([9000, 9001]),
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995803, STACK_REF("fix-replica-k"))}'; echo 'cursor 995803'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-k.log
${writeWaiterState("coalesce-labs/example:fix-replica-k", 9001, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-k" ".catalyst/waiter.fix-replica-k.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.calls.filter((call) => call.startsWith("mergify "))).toEqual([
      "mergify stack list --json",
      "mergify stack sync",
      "mergify stack push --keep-pull-request-title-and-body", // never the bare form
    ]);
    const parents = spawnSync("git", ["show", "-s", "--format=%P", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim().split(" ");
    expect(parents).toHaveLength(1); // a stack change is resynced, never merged
    expect(settleWaiterWaits(result)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995803)]);
  } finally {
    killWaiters("fix-replica-k");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// The control for an ordinary branch: its commits may carry Change-Id trailers because the
// repository has the stack hooks, but its pull request's head is the branch itself. A stack push
// from it would open a second pull request, so it merges and the stack tool is never run.
test("ordinary branch: Change-Id trailers alone never send a branch through a stack push", () => {
  const result = runWaiter({
    gitFixture: "ordinary", gitBranch: "fix-replica-p", fixtureOpts: { trailer: "Change-Id: I8f2c1" },
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995806, "fix-replica-p")}'; echo 'cursor 995806'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-p.log
${writeWaiterState("coalesce-labs/example:fix-replica-p", 9001, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-p" ".catalyst/waiter.fix-replica-p.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.calls.some((call) => call.startsWith("mergify "))).toBe(false);
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim();
    const parents = spawnSync("git", ["show", "-s", "--format=%P", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim().split(" ");
    expect(parents).toHaveLength(2); // merged, as any ordinary branch is
    const remoteTip = spawnSync("git", ["ls-remote", result.fixture.remote, "refs/heads/fix-replica-p"], { encoding: "utf8" }).stdout.split("\t")[0];
    expect(remoteTip).toBe(head);
    expect(settleWaiterWaits(result)).toBe(true);
  } finally {
    killWaiters("fix-replica-p");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("foreign head: a pull request whose head this branch's stack does not list is left alone", () => {
  const result = runWaiter({
    gitFixture: "foreign", gitBranch: "fix-replica-f", fixtureOpts: { trailer: "Change-Id: I8f2c1" },
    prHead: STACK_REF("another-branch"), stackList: stackList([9000], "fix-replica-f"),
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995807, STACK_REF("another-branch"))}'; echo 'cursor 995807'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-f.log
${writeWaiterState("coalesce-labs/example:fix-replica-f", 9001, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-f" ".catalyst/waiter.fix-replica-f.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stderr + result.stdout).toContain("this branch's stack does not list it");
    expect(result.calls.filter((call) => call.startsWith("mergify "))).toEqual(["mergify stack list --json"]);
    const parents = spawnSync("git", ["show", "-s", "--format=%P", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim().split(" ");
    expect(parents).toHaveLength(1); // nothing merged, nothing pushed
    expect(settleWaiterWaits(result)).toBe(true);
  } finally {
    killWaiters("fix-replica-f");
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

// The controls for identity. The event must name the pull request this waiter was armed for,
// by repository and number. A sibling pull request of the same ticket, the same number in
// another repository, and a ref nobody armed are each reported and touched by nothing.
for (const [name, event, armedFor, said] of [
  ["another pull request of the same ticket", CONFLICT_EVENT(995805, "fix-replica-o", "main", 9002), 9001, "the conflict is on coalesce-labs/example#9002, not coalesce-labs/example#9001"],
  ["the same number in another repository", CONFLICT_EVENT(995805, "fix-replica-o", "main", 9001, "coalesce-labs/elsewhere"), 9001, "the conflict is on coalesce-labs/elsewhere#9001, not coalesce-labs/example#9001"],
  ["a ref that was never armed", CONFLICT_EVENT(995805, "fix-replica-o"), null, "the conflict is on coalesce-labs/example#9001, not coalesce-labs/example#?"],
]) {
  test(`wrong pull request in the event: ${name} is reported, not merged`, () => {
    const result = runWaiter({
      gitFixture: "identity", gitBranch: "fix-replica-o", stackList: stackList([9001, 9002], "fix-replica-o"),
      code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${event}'; echo 'cursor 995805'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-o.log
${armedFor === null ? "echo '{}' > .catalyst/branch-waiter.json" : writeWaiterState("coalesce-labs/example:fix-replica-o", armedFor, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-o" ".catalyst/waiter.fix-replica-o.log"`,
    });
    try {
      expect(result.status).toBe(0);
      expect(result.stderr + result.stdout).toContain(said);
      expect(result.calls.some((call) => call.startsWith("gh ") || call.startsWith("mergify "))).toBe(false);
      const parents = spawnSync("git", ["show", "-s", "--format=%P", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim().split(" ");
      expect(parents).toHaveLength(1); // nothing merged
      const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim();
      const remoteTip = spawnSync("git", ["ls-remote", result.fixture.remote, "refs/heads/fix-replica-o"], { encoding: "utf8" }).stdout.split("\t")[0];
      expect(remoteTip).toBe(head); // nothing pushed
      expect(settleWaiterWaits(result)).toBe(true);
      expect(waiterWaits(callsNow(result))).toEqual([fullWait(995805)]);
      // The re-arm keeps the pull request the waiter was armed for; an event never renames it.
      const state = JSON.parse(readFileSync(statePath(result), "utf8"));
      expect(state["coalesce-labs/example:fix-replica-o"].pr).toBe(armedFor ?? 0);
    } finally {
      killWaiters("fix-replica-o");
      rmSync(result.dir, { recursive: true, force: true });
    }
  });
}

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
    expect(result.stdout).toContain("catalyst inbox check"); // CTC-10679: the seat acknowledges through its inbox
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

// The released CLI has no exit code of its own for a wait that ends with no event: it exits 1
// and says so on stderr. The waiter turns exactly that into 124, so the wait is armed again.
test("timeout through the wait itself: the CLI's exit 1 with its no-event line is recorded as 124 and re-armed", () => {
  const result = runWaiter({
    code: `${armBlock()}\n${wakeBlock()}\n${armCall("fix-replica-q")}
wait
cat .catalyst/waiter.fix-replica-q.log
handle_waiter_wake "coalesce-labs/example" "fix-replica-q" ".catalyst/waiter.fix-replica-q.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("events: no matching event within 14400 s");
    expect(result.stdout).toContain("cursor 40\nwaiter-rc 124");
    expect(result.stdout).not.toContain("not re-arming");
    expect(settleWaiterWaits(result, 2)).toBe(true);
    expect(waiterWaits(callsNow(result)).slice(0, 2)).toEqual([fullWait(40), fullWait(40)]);
    expect(result.calls.some((call) => call.startsWith("gh ") || call.startsWith("mergify ") || call.startsWith("catalyst messages"))).toBe(false);
  } finally {
    killWaiters("fix-replica-q");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("failed wait: any other failure keeps its exit code and the CLI's message, and is not re-armed", () => {
  const result = runWaiter({
    waitRc: 2, waitErr: "catalyst: not connected yet",
    code: `${armBlock()}\n${wakeBlock()}\n${armCall("fix-replica-e")}
wait
handle_waiter_wake "coalesce-labs/example" "fix-replica-e" ".catalyst/waiter.fix-replica-e.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("the wait on coalesce-labs/example:fix-replica-e failed (exit 2): catalyst: not connected yet; not re-arming.");
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(40)]);
  } finally {
    killWaiters("fix-replica-e");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// A timeout of 0 starts a waiter that makes no call and ends at once, so every re-arm would report
// another timeout. A leading zero breaks the waiter's arithmetic after an event it skips, and a
// number too long to count does the same at once. None of them starts a wait or leaves state.
// The control is the smallest real timeout, which does.
test("arm: a timeout of 0, one with a leading zero or one too long to count starts no wait, and 1 s does", () => {
  for (const secs of ["0", "08", "1000000000", "1"]) {
    const result = runWaiter({
      code: `${armBlock()}\nWAITER_TIMEOUT_SECONDS=${secs} ${armCall("fix-replica-t0")}
echo "state: $(cat .catalyst/branch-waiter.json 2>/dev/null)"`,
    });
    try {
      expect(result.status).toBe(0);
      if (secs === "1") {
        expect(result.stderr).not.toContain("arm needs");
        expect(settleWaiterWaits(result, 1)).toBe(true);
        expect(waiterWaits(callsNow(result))).toEqual([fullWait(40, 1)]);
      } else {
        expect(result.stderr).toContain("a timeout of 1 to 999999999 whole seconds with no leading zero");
        expect(result.stdout).toContain("state: \n");
        expect(waits(callsNow(result))).toHaveLength(0);
      }
    } finally {
      killWaiters("fix-replica-t0");
      rmSync(result.dir, { recursive: true, force: true });
    }
  }
});

// An exit 1 that is not the no-event line is a failure, never a timeout: the usage error the
// released CLI gives for a timeout that is not whole seconds is the case that hid for a month.
test("failed wait: an exit 1 without the no-event line is a failure, never a timeout", () => {
  const result = runWaiter({
    code: `${armBlock()}\n${wakeBlock()}\nWAITER_TIMEOUT_SECONDS=4h ${armCall("fix-replica-u")}
echo "state: $(cat .catalyst/branch-waiter.json 2>/dev/null)"
mkdir -p .catalyst
{ echo '--timeout must be an integer'; echo 'Usage: catalyst events ...'; echo 'cursor 40'; echo 'waiter-rc 1'; } > .catalyst/waiter.fix-replica-u.log
handle_waiter_wake "coalesce-labs/example" "fix-replica-u" ".catalyst/waiter.fix-replica-u.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("arm needs a numeric cursor and PR, a timeout of 1 to 999999999 whole seconds"); // a timeout that is not seconds never starts a wait
    expect(result.stdout).toContain("state: \n");
    expect(result.stdout).toContain("failed (exit 1): --timeout must be an integer; not re-arming.");
    expect(waits(callsNow(result))).toHaveLength(0);
  } finally {
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// Another event of the same ticket (a phase, a push) ends the CLI's wait as well, because the
// wait carries no type. The waiter keeps none of it and waits on from that event's sequence.
test("selection: the waiter skips another event of the ticket and wakes on the conflict after it", () => {
  const other = JSON.stringify({ sequence: 41, type: "github.pr.synchronize", payload: { repo: "coalesce-labs/example", pr: 9001, ticket: "ENG-123" } });
  const result = runWaiter({
    waitEvents: [other, CONFLICT_EVENT(42, STACK_REF("fix-replica-s"))],
    code: `${armBlock()}\n${armCall("fix-replica-s")}
wait
cat .catalyst/waiter.fix-replica-s.log`,
  });
  try {
    expect(result.status).toBe(0);
    const logged = result.stdout.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line).type);
    expect(logged).toEqual(["pr.conflict.detected"]);
    expect(result.stdout).toContain("cursor 42\nwaiter-rc 0");
    const made = waiterWaits(callsNow(result));
    expect(made).toHaveLength(2);
    expect(made[0]).toBe(fullWait(40));
    expect(made[1]).toMatch(/^catalyst events wait-for --ticket ENG-123 --after 41 --timeout \d+$/);
  } finally {
    killWaiters("fix-replica-s");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// A wait that skips events and then ends with no event has still read them. The next wait
// starts after the last one it skipped, so a long-lived waiter never reads a ticket's history again.
test("timeout after skipped events: the next wait starts from the sequence the waiter reached", () => {
  const other = JSON.stringify({ sequence: 41, type: "github.pr.synchronize", payload: { repo: "coalesce-labs/example", pr: 9001, ticket: "ENG-123" } });
  const result = runWaiter({
    waitEvents: [other],
    code: `${armBlock()}\n${wakeBlock()}\n${armCall("fix-replica-k2")}
wait
cat .catalyst/waiter.fix-replica-k2.log
handle_waiter_wake "coalesce-labs/example" "fix-replica-k2" ".catalyst/waiter.fix-replica-k2.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("cursor 41\nwaiter-rc 124");
    expect(settleWaiterWaits(result, 3)).toBe(true);
    const made = waiterWaits(callsNow(result));
    expect(made[0]).toBe(fullWait(40));
    expect(made[1]).toMatch(/^catalyst events wait-for --ticket ENG-123 --after 41 --timeout \d+$/);
    expect(made[2]).toBe(fullWait(41)); // the re-armed wait, from the reached sequence
    expect(JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-k2"].cursor).toBe(41);
  } finally {
    killWaiters("fix-replica-k2");
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

// A machine can carry a `catalyst` in a system directory. The control for an absent CLI must not
// reach it, or it tests whatever that machine has installed. The decoy here stands in for one.
test("absent CLI: a catalyst in a system directory is not reachable, and the other tools there still are", () => {
  const decoy = mkdtempSync(join(tmpdir(), "branch-waiter-decoy-"));
  writeFileSync(join(decoy, "catalyst"), '#!/bin/bash\necho "catalyst-decoy $*" >> "$CALL_LOG"\necho \'{"head":40,"reachable":true}\'\n', { mode: 0o755 });
  writeFileSync(join(decoy, "decoy-tool"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  const result = runWaiter({
    absent: true, systemDirs: [decoy, "/usr/bin", "/bin"],
    code: `${armBlock()}\n${armCall("fix-replica-n2")}
command -v decoy-tool >/dev/null && echo "the other tools are kept"
PATH="$RAW_SYSTEM_PATH" command -v catalyst >/dev/null && echo "the decoy is reachable on the unfiltered path"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("the decoy is reachable on the unfiltered path"); // the control: the decoy is real
    expect(result.stdout).toContain("the other tools are kept");
    expect(result.calls.some((call) => call.startsWith("catalyst"))).toBe(false);
    expect(result.stderr.trim().split("\n")).toEqual(["branch-waiter: catalyst CLI absent; not arming a waiter on coalesce-labs/example:fix-replica-n2."]);
    expect(existsSync(join(result.cwd, ".catalyst"))).toBe(false);
  } finally {
    rmSync(result.dir, { recursive: true, force: true });
    rmSync(decoy, { recursive: true, force: true });
  }
});

// A read of the pull request can fail for a moment. The handler must not push on a pull request
// it could not read, and it must not stop watching either: it records the conflict as pending,
// arms a short wait, and the wake that ends that wait tries the same conflict again.
test("failed read, then recovery: nothing is pushed on the failed read, the waiter is armed once, and the next wake resyncs once", () => {
  const result = runWaiter({
    gitFixture: "retry", gitBranch: "fix-replica-r", fixtureOpts: { trailer: "Change-Id: I8f2c1" },
    prHead: STACK_REF("fix-replica-r"), stackList: stackList([9001], "fix-replica-r"), ghFailReads: 1,
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995803, STACK_REF("fix-replica-r"))}'; echo 'cursor 995803'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-r.log
${writeWaiterState("coalesce-labs/example:fix-replica-r", 9001, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-r" ".catalyst/waiter.fix-replica-r.log"
echo "calls after the failed read: $(grep -c '^mergify ' "$CALL_LOG")"
wait
echo "state after the failed read: $(jq -c . .catalyst/branch-waiter.json)"
echo "log of the retry wait: $(tr '\\n' ' ' < .catalyst/waiter.fix-replica-r.log)"
${backdateDue("coalesce-labs/example:fix-replica-r")}
handle_waiter_wake "coalesce-labs/example" "fix-replica-r" ".catalyst/waiter.fix-replica-r.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("cannot read the base and head of PR #9001 (try 1 of 3); nothing pushed. The conflict on coalesce-labs/example:fix-replica-r stays pending and is tried again in 300 s.");
    expect(result.stdout).toContain("calls after the failed read: 0");
    expect(result.stdout).toMatch(/state after the failed read: .*"pending":1/);
    expect(result.stdout).toContain("cursor 995803 waiter-rc 124"); // the retry wait ended with no event: nobody woke it
    expect(result.calls.filter((call) => call.startsWith("gh api repos/coalesce-labs/example/pulls/9001 --jq .base.ref"))).toHaveLength(2);
    expect(result.calls.filter((call) => call.startsWith("mergify "))).toEqual([
      "mergify stack list --json",
      "mergify stack sync",
      "mergify stack push --keep-pull-request-title-and-body", // once: the failed read pushed nothing
    ]);
    expect(settleWaiterWaits(result, 2)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995803, 300), fullWait(995803)]); // one arm per wake
    const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-r"];
    expect(state).toEqual({ pr: 9001, ticket: "ENG-123", cursor: 995803 }); // the pending mark is cleared
  } finally {
    killWaiters("fix-replica-r");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// A wait can end with no event before the due time: the retry setting was lowered after the
// conflict was saved (the wait is capped at the setting), or the wait was cut short. The due
// time still rules: no try is spent, so the three tries cannot run out ahead of schedule.
test("pending conflict, a wait that ends with no event before the due time: no try is used, the due time is kept and only the time left is armed", () => {
  for (const retry of [null, 5]) {
    const result = runWaiter({
      ghFailReads: 9,
      code: `${armBlock()}\n${wakeBlock()}
${retry ? `export WAITER_RETRY_SECONDS=${retry}` : ""}
mkdir -p .catalyst
{ echo 'events: no matching event within 5 s'; echo 'cursor 995803'; echo 'waiter-rc 124'; } > .catalyst/waiter.fix-replica-e1.log
${writePendingState("coalesce-labs/example:fix-replica-e1", 2, 120)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-e1" ".catalyst/waiter.fix-replica-e1.log"`,
    });
    try {
      expect(result.status).toBe(0);
      expect(result.calls.some((call) => call.startsWith("gh api") || call.startsWith("mergify "))).toBe(false);
      expect(result.stderr).not.toContain("try ");
      expect(result.stderr).not.toContain("Giving up");
      expect(settleWaiterWaits(result, 1)).toBe(true);
      const armed = waiterWaits(callsNow(result));
      expect(armed).toHaveLength(1);
      if (retry) expect(armed[0]).toBe(fullWait(995803, retry)); // capped at the setting, and the next wake is still before the due time
      else { expect(armedSeconds(armed[0])).toBeGreaterThanOrEqual(100); expect(armedSeconds(armed[0])).toBeLessThanOrEqual(120); }
      const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-e1"];
      expect(state).toEqual({ pr: 9001, ticket: "ENG-123", cursor: 995803, pending: 2, due: dueWritten(result) });
    } finally {
      killWaiters("fix-replica-e1");
      rmSync(result.dir, { recursive: true, force: true });
    }
  }
});

// The handler reads the clock again after the message read. A message that arrives just before
// the due time, with a read that runs past it, must not arm a wait from a time already gone.
test("pending conflict, a message read that runs past the due time: the retry runs on that same wake", () => {
  const result = runWaiter({
    gitFixture: "slowread", gitBranch: "fix-replica-e2", ghFailReads: 9, messagesSleep: 4,
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${MESSAGE_EVENT(995811)}'; echo 'cursor 995811'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-e2.log
${writePendingState("coalesce-labs/example:fix-replica-e2", 1, 2)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-e2" ".catalyst/waiter.fix-replica-e2.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("branch-waiter: message for ENG-123 on coalesce-labs/example:fix-replica-e2");
    expect(result.stderr).toContain("cannot read the base and head of PR #9001 (try 2 of 3); nothing pushed.");
    expect(result.calls.filter((call) => call.startsWith("gh api repos/coalesce-labs/example/pulls/9001 --jq .base.ref"))).toHaveLength(1);
    expect(settleWaiterWaits(result, 1)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995811, 300)]);
    const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-e2"];
    expect(state.pending).toBe(2);
    expect(state.due - dueWritten(result)).toBeGreaterThanOrEqual(300);
  } finally {
    killWaiters("fix-replica-e2");
    rmSync(result.dir, { recursive: true, force: true });
  }
}, 30000);

// The same for the try itself: its read of the pull request can be slow, and the next due time
// is a full retry wait after the try ended, not after the handler started.
test("pending conflict, a slow failed try: the next due time is counted from the end of the try", () => {
  const result = runWaiter({
    gitFixture: "slowtry", gitBranch: "fix-replica-e3", ghFailReads: 9, ghSleep: 3,
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995803, "fix-replica-e3")}'; echo 'cursor 995803'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-e3.log
${writeWaiterState("coalesce-labs/example:fix-replica-e3", 9001, 995788)}
echo "start $(date +%s)"
handle_waiter_wake "coalesce-labs/example" "fix-replica-e3" ".catalyst/waiter.fix-replica-e3.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("(try 1 of 3); nothing pushed.");
    expect(settleWaiterWaits(result, 1)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995803, 300)]);
    const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-e3"];
    const start = Number(result.stdout.match(/^start (\d+)$/m)[1]);
    expect(state.pending).toBe(1);
    expect(state.due - start).toBeGreaterThanOrEqual(303); // the 3 s read is not taken out of the wait
  } finally {
    killWaiters("fix-replica-e3");
    rmSync(result.dir, { recursive: true, force: true });
  }
}, 30000);

// Two things must not lose a pending conflict or keep it forever: a conflict event for some
// other pull request, and a retry that finds another branch checked out.
test("pending conflict: a conflict on another pull request uses no try, keeps the due time and arms only the time left", () => {
  const result = runWaiter({
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995803, "fix-replica-p", "main", 9002)}'; echo 'cursor 995803'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-p.log
${writePendingState("coalesce-labs/example:fix-replica-p", 1, 120)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-p" ".catalyst/waiter.fix-replica-p.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("the conflict is on coalesce-labs/example#9002, not coalesce-labs/example#9001");
    expect(result.calls.some((call) => call.startsWith("gh api") || call.startsWith("mergify "))).toBe(false);
    expect(settleWaiterWaits(result, 1)).toBe(true);
    const armed = waiterWaits(callsNow(result));
    expect(armed).toHaveLength(1);
    expect(armedSeconds(armed[0])).toBeGreaterThanOrEqual(100);
    expect(armedSeconds(armed[0])).toBeLessThanOrEqual(120);
    const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-p"];
    expect(state).toEqual({ pr: 9001, ticket: "ENG-123", cursor: 995803, pending: 1, due: dueWritten(result) });
  } finally {
    killWaiters("fix-replica-p");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// A message is a wake too. It must not move the time the pending conflict is due, must not use
// one of its three tries, and must not hold the retry back once that time has come.
test("pending conflict, early messages: each keeps the due time, uses no try and arms only the time left", () => {
  const messageWake = (sequence) => `{ printf '%s\\n' '${MESSAGE_EVENT(sequence)}'; echo 'cursor ${sequence}'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-m1.log
handle_waiter_wake "coalesce-labs/example" "fix-replica-m1" ".catalyst/waiter.fix-replica-m1.log"; wait`;
  const result = runWaiter({
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
${writePendingState("coalesce-labs/example:fix-replica-m1", 2, 120)}
${[995811, 995812, 995813].map(messageWake).join("\n")}`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stdout.match(/branch-waiter: message for ENG-123 on /g)).toHaveLength(3);
    expect(result.calls.some((call) => call.startsWith("gh api") || call.startsWith("mergify "))).toBe(false);
    expect(result.stderr).not.toContain("try ");
    const armed = waiterWaits(callsNow(result)).map(armedSeconds);
    expect(armed).toHaveLength(3);
    for (const seconds of armed) { expect(seconds).toBeGreaterThanOrEqual(100); expect(seconds).toBeLessThanOrEqual(120); }
    expect(armed[2]).toBeLessThanOrEqual(armed[0]); // the time left only shrinks: no message restarts it
    const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-m1"];
    expect(state).toEqual({ pr: 9001, ticket: "ENG-123", cursor: 995813, pending: 2, due: dueWritten(result) });
  } finally {
    killWaiters("fix-replica-m1");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("pending conflict, a message at or after the due time: the retry runs on that wake, and a failed try sets a new full wait", () => {
  const result = runWaiter({
    gitFixture: "due", gitBranch: "fix-replica-m2", ghFailReads: 9,
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${MESSAGE_EVENT(995811)}'; echo 'cursor 995811'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-m2.log
${writePendingState("coalesce-labs/example:fix-replica-m2", 1, -5)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-m2" ".catalyst/waiter.fix-replica-m2.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("branch-waiter: message for ENG-123 on coalesce-labs/example:fix-replica-m2");
    expect(result.stderr).toContain("cannot read the base and head of PR #9001 (try 2 of 3); nothing pushed.");
    expect(result.calls.filter((call) => call.startsWith("gh api repos/coalesce-labs/example/pulls/9001 --jq .base.ref"))).toHaveLength(1);
    expect(settleWaiterWaits(result, 1)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995811, 300)]);
    const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-m2"];
    expect(state.pending).toBe(2);
    expect(state.due - dueWritten(result)).toBeGreaterThanOrEqual(300); // a new full wait from this try, not from the old time
    expect(state.due - dueWritten(result)).toBeLessThanOrEqual(325);
  } finally {
    killWaiters("fix-replica-m2");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// The handler reads the clock three times: for a due time it has to make up, before it decides on
// a retry, and for the time left to arm. This test owns that clock. Every reading is `step` seconds
// after the one before, so with a step the readings cross second boundaries on purpose. The due
// time is the first reading plus the retry wait, and the wait armed is that time minus the last
// reading. On the real clock the two can be a second apart, and an exact 300 would fail there.
test("pending conflict, a missing or unreadable due time: the due time is a full retry wait from the first clock reading and is kept, and the time left at the last reading is armed", () => {
  const first = 1900000000;
  for (const { due, step } of [{ due: undefined, step: 0 }, { due: undefined, step: 1 }, { due: "soon", step: 1 }, { due: 0, step: 7 }]) {
    const entry = { pr: 9001, ticket: "ENG-123", cursor: 995788, pending: 1, ...(due === undefined ? {} : { due }) };
    const result = runWaiter({
      code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${MESSAGE_EVENT(995811)}'; echo 'cursor 995811'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-m3.log
printf '%s\\n' '${JSON.stringify({ "coalesce-labs/example:fix-replica-m3": entry })}' > .catalyst/branch-waiter.json
date() { local n; n=$(cat .catalyst/clock-readings 2>/dev/null || echo 0); echo $((n + 1)) > .catalyst/clock-readings; echo $((${first} + n * ${step})); }
handle_waiter_wake "coalesce-labs/example" "fix-replica-m3" ".catalyst/waiter.fix-replica-m3.log"
echo "clock readings: $(cat .catalyst/clock-readings)"`,
    });
    try {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("clock readings: 3\n"); // the control: the handler read this clock, and three times
      expect(result.calls.some((call) => call.startsWith("gh api"))).toBe(false);
      expect(settleWaiterWaits(result, 1)).toBe(true);
      expect(waiterWaits(callsNow(result))).toEqual([fullWait(995811, 300 - 2 * step)]); // the due time minus the last reading
      const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-m3"];
      expect(state).toEqual({ pr: 9001, ticket: "ENG-123", cursor: 995811, pending: 1, due: first + 300 });
    } finally {
      killWaiters("fix-replica-m3");
      rmSync(result.dir, { recursive: true, force: true });
    }
  }
});

// The waiter passes on two event types only. If any other event ever ended a wait while a
// conflict was overdue, the wait armed next must still be a real one: one second, never zero.
test("pending conflict overdue on a wake that is neither a message nor a conflict: a 1 s wait is armed, never 0", () => {
  const other = JSON.stringify({ sequence: 995811, type: "phase.started", entity: { type: "ticket", id: "ENG-123" }, payload: {} });
  const result = runWaiter({
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${other}'; echo 'cursor 995811'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-m4.log
${writePendingState("coalesce-labs/example:fix-replica-m4", 1, -5)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-m4" ".catalyst/waiter.fix-replica-m4.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(settleWaiterWaits(result, 1)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995811, 1)]);
    const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-m4"];
    expect(state).toEqual({ pr: 9001, ticket: "ENG-123", cursor: 995811, pending: 1, due: dueWritten(result) });
  } finally {
    killWaiters("fix-replica-m4");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// The whole sequence in real time, with a 6 s retry wait: the read fails, two messages arrive
// before the retry is due, and a third arrives after it. No quiet period is needed.
test("pending conflict, a message stream that crosses the due time: early messages use no try, and the first message after it resyncs once", () => {
  const messageWake = (sequence) => `{ printf '%s\\n' '${MESSAGE_EVENT(sequence)}'; echo 'cursor ${sequence}'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-m5.log
handle_waiter_wake "coalesce-labs/example" "fix-replica-m5" ".catalyst/waiter.fix-replica-m5.log"; wait`;
  const result = runWaiter({
    gitFixture: "stream", gitBranch: "fix-replica-m5", fixtureOpts: { trailer: "Change-Id: I8f2c1" },
    prHead: STACK_REF("fix-replica-m5"), stackList: stackList([9001], "fix-replica-m5"), ghFailReads: 1,
    code: `${armBlock()}\n${wakeBlock()}
export WAITER_RETRY_SECONDS=6
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995803, STACK_REF("fix-replica-m5"))}'; echo 'cursor 995803'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-m5.log
${writeWaiterState("coalesce-labs/example:fix-replica-m5", 9001, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-m5" ".catalyst/waiter.fix-replica-m5.log"; wait
${[995811, 995812].map(messageWake).join("\n")}
echo "reads before the due time: $(grep -c '^gh api repos/coalesce-labs/example/pulls/9001 --jq .base.ref' "$CALL_LOG")"
echo "pushes before the due time: $(grep -c '^mergify stack push' "$CALL_LOG")"
echo "state before the due time: $(jq -c . .catalyst/branch-waiter.json)"
sleep 6
${messageWake(995813)}`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("(try 1 of 3); nothing pushed. The conflict on coalesce-labs/example:fix-replica-m5 stays pending and is tried again in 6 s.");
    expect(result.stderr).not.toContain("(try 2 of 3)");
    expect(result.stdout).toContain("reads before the due time: 1");
    expect(result.stdout).toContain("pushes before the due time: 0");
    expect(result.stdout).toMatch(/state before the due time: .*"pending":1/);
    expect(result.stdout.match(/branch-waiter: message for ENG-123 on /g)).toHaveLength(3);
    expect(result.calls.filter((call) => call.startsWith("gh api repos/coalesce-labs/example/pulls/9001 --jq .base.ref"))).toHaveLength(2);
    expect(result.calls.filter((call) => call.startsWith("mergify "))).toEqual([
      "mergify stack list --json",
      "mergify stack sync",
      "mergify stack push --keep-pull-request-title-and-body",
    ]);
    expect(settleWaiterWaits(result, 4)).toBe(true);
    const armed = waiterWaits(callsNow(result));
    expect(armed).toHaveLength(4);
    expect(armed[0]).toBe(fullWait(995803, 6));
    for (const call of armed.slice(1, 3)) { expect(armedSeconds(call)).toBeGreaterThanOrEqual(1); expect(armedSeconds(call)).toBeLessThanOrEqual(6); }
    expect(armed[3]).toBe(fullWait(995813));
    const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-m5"];
    expect(state).toEqual({ pr: 9001, ticket: "ENG-123", cursor: 995813 });
  } finally {
    killWaiters("fix-replica-m5");
    rmSync(result.dir, { recursive: true, force: true });
  }
}, 30000);

// A pending conflict is saved for one pull request. Arming the same branch for another one must
// not carry it over, or the next due retry would bring the branch current for a pull request that
// had no conflict event. An arm for the same pull request, which every re-arm is, keeps it.
test("arm for another pull request: the pending conflict saved for the first is dropped, and an arm for the same one keeps it", () => {
  for (const pr of [9002, 9001]) {
    const result = runWaiter({
      code: `${armBlock()}
mkdir -p .catalyst
${writePendingState("coalesce-labs/example:fix-replica-p2", 2, 200)}
arm_branch_waiter "coalesce-labs/example" "fix-replica-p2" ${pr} "ENG-123"`,
    });
    try {
      expect(result.status).toBe(0);
      expect(settleWaiterWaits(result, 1)).toBe(true);
      expect(waiterWaits(callsNow(result))).toEqual([fullWait(995788)]);
      const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-p2"];
      expect(state).toEqual(
        pr === 9001
          ? { pr: 9001, ticket: "ENG-123", cursor: 995788, pending: 2, due: dueWritten(result) }
          : { pr: 9002, ticket: "ENG-123", cursor: 995788 },
      );
    } finally {
      killWaiters("fix-replica-p2");
      rmSync(result.dir, { recursive: true, force: true });
    }
  }
});

test("pending conflict on another branch: each wake there uses up a try, so the retries end", () => {
  const result = runWaiter({
    gitFixture: "elsewhere", gitBranch: "fix-replica-h",
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
git checkout -q -b elsewhere
{ echo 'events: no matching event within 300 s'; echo 'cursor 995803'; echo 'waiter-rc 124'; } > .catalyst/waiter.fix-replica-h.log
printf '%s\\n' '${JSON.stringify({ "coalesce-labs/example:fix-replica-h": { pr: 9001, ticket: "ENG-123", cursor: 995803, pending: 1, due: 1 } })}' > .catalyst/branch-waiter.json
handle_waiter_wake "coalesce-labs/example" "fix-replica-h" ".catalyst/waiter.fix-replica-h.log"; wait
echo "state after one wake: $(jq -c '.[]' .catalyst/branch-waiter.json)"
${backdateDue("coalesce-labs/example:fix-replica-h")}
handle_waiter_wake "coalesce-labs/example" "fix-replica-h" ".catalyst/waiter.fix-replica-h.log"; wait`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stderr.match(/HEAD is elsewhere, not fix-replica-h/g)).toHaveLength(2);
    expect(result.stderr.match(/switch to fix-replica-h and rerun this handler\./g)).toHaveLength(1); // the second try: one is left
    expect(result.stderr.match(/that was the last try of the pending conflict, so bring fix-replica-h current by hand\./g)).toHaveLength(1); // the third: nothing is left to rerun
    expect(result.stdout).toMatch(/state after one wake: .*"pending":2/);
    expect(result.calls.some((call) => call.startsWith("gh api") || call.startsWith("mergify "))).toBe(false);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995803, 300), fullWait(995803)]);
    const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-h"];
    expect(state).toEqual({ pr: 9001, ticket: "ENG-123", cursor: 995803 });
  } finally {
    killWaiters("fix-replica-h");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("failed read, three times: the handler gives up on that conflict, says so, pushes nothing and goes back to the full wait", () => {
  const result = runWaiter({
    gitFixture: "giveup", gitBranch: "fix-replica-g", ghFailReads: 9,
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995803, "fix-replica-g")}'; echo 'cursor 995803'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-g.log
${writeWaiterState("coalesce-labs/example:fix-replica-g", 9001, 995788)}
for try in 1 2 3; do handle_waiter_wake "coalesce-labs/example" "fix-replica-g" ".catalyst/waiter.fix-replica-g.log"; wait; ${backdateDue("coalesce-labs/example:fix-replica-g")}; done`,
  });
  try {
    expect(result.status).toBe(0);
    for (const n of [1, 2, 3]) expect(result.stderr).toContain(`(try ${n} of 3); nothing pushed.`);
    expect(result.stderr).not.toContain("(try 4 of 3)");
    expect(result.stderr).toContain("Giving up on it: bring coalesce-labs/example:fix-replica-g current by hand.");
    expect(result.calls.some((call) => call.startsWith("mergify "))).toBe(false);
    const parents = spawnSync("git", ["show", "-s", "--format=%P", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim().split(" ");
    expect(parents).toHaveLength(1); // nothing merged
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: result.fixture.seat, encoding: "utf8" }).stdout.trim();
    const remoteTip = spawnSync("git", ["ls-remote", result.fixture.remote, "refs/heads/fix-replica-g"], { encoding: "utf8" }).stdout.split("\t")[0];
    expect(remoteTip).toBe(head); // nothing pushed
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995803, 300), fullWait(995803, 300), fullWait(995803)]);
    const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-g"];
    expect(state).toEqual({ pr: 9001, ticket: "ENG-123", cursor: 995803 });
  } finally {
    killWaiters("fix-replica-g");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// The status read gives a first arm its starting sequence. A re-arm already has one saved, so a
// status read that fails there must not end the watch: the ticket would get no later wake.
test("failed status read, first arm: with no saved sequence the arm reports it and starts no wait", () => {
  const result = runWaiter({ statusRc: 4, code: `${armBlock()}\n${armCall("fix-replica-s1")}` });
  try {
    expect(result.status).toBe(0);
    expect(waits(result.calls)).toHaveLength(0);
    expect(result.stderr.trim().split("\n")).toEqual(["branch-waiter: catalyst events status failed; not arming a waiter on coalesce-labs/example:fix-replica-s1."]);
    expect(existsSync(join(result.cwd, ".catalyst"))).toBe(false);
  } finally {
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("failed status read at a re-arm: the saved sequence is kept and each wake arms exactly one wait from it", () => {
  const result = runWaiter({
    statusRc: 4,
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ echo 'events: no matching event within 14400 s'; echo 'cursor 995803'; echo 'waiter-rc 124'; } > .catalyst/waiter.fix-replica-s2.log
${writeWaiterState("coalesce-labs/example:fix-replica-s2", 9001, 995788)}
for wake in 1 2 3; do handle_waiter_wake "coalesce-labs/example" "fix-replica-s2" ".catalyst/waiter.fix-replica-s2.log"; wait; done`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stderr.match(/catalyst events status failed; waiting on coalesce-labs\/example:fix-replica-s2 from its saved sequence 995803 anyway\./g)).toHaveLength(3);
    expect(result.stderr).not.toContain("not arming");
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995803), fullWait(995803), fullWait(995803)]); // one wait per wake, never more
    const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-s2"];
    expect(state).toEqual({ pr: 9001, ticket: "ENG-123", cursor: 995803 });
  } finally {
    killWaiters("fix-replica-s2");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("failed status read at a re-arm while a waiter lives: no second wait is started", () => {
  const result = runWaiter({
    statusRc: 4, waitSleep: 30,
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ echo 'cursor 995803'; echo 'waiter-rc 124'; } > .catalyst/waiter.fix-replica-s3.log
${writeWaiterState("coalesce-labs/example:fix-replica-s3", 9001, 995803)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-s3" ".catalyst/waiter.fix-replica-s3.log"
handle_waiter_wake "coalesce-labs/example" "fix-replica-s3" ".catalyst/waiter.fix-replica-s3.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(settleWaiterWaits(result)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995803)]);
    expect(result.stdout.trim().split("\n").filter((line) => line.includes("already running"))).toHaveLength(1);
  } finally {
    killWaiters("fix-replica-s3");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// One outage can break the read of the pull request and the status read together. The handler
// has just said the conflict is tried again in 300 s, so that wait has to exist.
test("failed read and failed status read together: the conflict stays pending, one 300 s wait is armed, and the next wake resyncs once", () => {
  const result = runWaiter({
    gitFixture: "both", gitBranch: "fix-replica-b", fixtureOpts: { trailer: "Change-Id: I8f2c1" },
    prHead: STACK_REF("fix-replica-b"), stackList: stackList([9001], "fix-replica-b"), ghFailReads: 1, statusFailCalls: 1,
    code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ printf '%s\\n' '${CONFLICT_EVENT(995803, STACK_REF("fix-replica-b"))}'; echo 'cursor 995803'; echo 'waiter-rc 0'; } > .catalyst/waiter.fix-replica-b.log
${writeWaiterState("coalesce-labs/example:fix-replica-b", 9001, 995788)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-b" ".catalyst/waiter.fix-replica-b.log"
wait
echo "state after the failed reads: $(jq -c . .catalyst/branch-waiter.json)"
echo "waits after the failed reads: $(grep -c '^catalyst events wait-for ' "$CALL_LOG")"
${backdateDue("coalesce-labs/example:fix-replica-b")}
handle_waiter_wake "coalesce-labs/example" "fix-replica-b" ".catalyst/waiter.fix-replica-b.log"`,
  });
  try {
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("(try 1 of 3); nothing pushed. The conflict on coalesce-labs/example:fix-replica-b stays pending and is tried again in 300 s.");
    expect(result.stderr.match(/catalyst events status failed; waiting on coalesce-labs\/example:fix-replica-b from its saved sequence 995803 anyway\./g)).toHaveLength(1);
    expect(result.stdout).toMatch(/state after the failed reads: .*"pending":1,"due":\d+/); // the due time survives the arm that follows a failed status read
    expect(result.stdout).toContain("waits after the failed reads: 1");
    expect(result.calls.filter((call) => call.startsWith("mergify "))).toEqual([
      "mergify stack list --json",
      "mergify stack sync",
      "mergify stack push --keep-pull-request-title-and-body",
    ]);
    expect(settleWaiterWaits(result, 2)).toBe(true);
    expect(waiterWaits(callsNow(result))).toEqual([fullWait(995803, 300), fullWait(995803)]);
    const state = JSON.parse(readFileSync(statePath(result), "utf8"))["coalesce-labs/example:fix-replica-b"];
    expect(state).toEqual({ pr: 9001, ticket: "ENG-123", cursor: 995803 });
  } finally {
    killWaiters("fix-replica-b");
    rmSync(result.dir, { recursive: true, force: true });
  }
});

// A wait that failed outright is still a stop: the table's rows for exit 1, 2 and 3 do not
// re-arm, with or without a saved sequence, whatever the status read would answer.
test("failed wait with a saved sequence: exit 1, 2 and 3 still stop without arming, and no status read is made", () => {
  for (const [rc, said] of [[1, "failed (exit 1)"], [2, "failed (exit 2)"], [3, "refused this wait filter (exit 3)"]]) {
    const result = runWaiter({
      statusRc: 4,
      code: `${armBlock()}\n${wakeBlock()}
mkdir -p .catalyst
{ echo 'events: the request failed'; echo 'cursor 995803'; echo 'waiter-rc ${rc}'; } > .catalyst/waiter.fix-replica-t.log
${writeWaiterState("coalesce-labs/example:fix-replica-t", 9001, 995803)}
handle_waiter_wake "coalesce-labs/example" "fix-replica-t" ".catalyst/waiter.fix-replica-t.log"`,
    });
    try {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(said);
      expect(result.calls.filter((call) => call.startsWith("catalyst "))).toEqual([]);
    } finally {
      rmSync(result.dir, { recursive: true, force: true });
    }
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
  expect(pkg.version).toBe("0.16.0");
  expect(plugin.version).toBe(pkg.version);
});
