import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const monitoring = "skills/create-pr/references/monitoring-loop.md";
const blocker = "skills/merge-pr/references/blocker-loop.md";

function example(path) {
  return readFileSync(new URL(path, root), "utf8").match(/```bash\n([\s\S]*?)```/)[1];
}

function runExample(path, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pr-cloud-events-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls");
  const script = (name, body) => writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  if (!options.absent) script("catalyst", `echo "catalyst $*" >> "$CALL_LOG"
if [ "$2" = status ]; then
  [ "$STATUS_FAIL" != true ] || exit 4
  [ "$FAIL_AFTER_WAIT" != true ] || [ ! -f "$WOKE" ] || exit 4
  echo "$STATUS_JSON"; exit 0
fi
n=$(cat "$WAIT_COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$WAIT_COUNT"
touch "$WOKE"
[ "$MOCK_WAIT_RC" = 0 ] || exit "$MOCK_WAIT_RC"
echo "$EVENTS_JSON" | jq -ce --argjson n "$n" '.[$n - 1]'`);
  script("gh", `echo "gh $*" >> "$CALL_LOG"
if [ "$1" = repo ]; then echo "$REPO_NAME"; exit 0; fi
if [ "$4" = '.merge_commit_sha // empty' ]; then
  [ ! -f "$WOKE" ] || echo merge-sha; exit 0
fi
if [ "$GH_FAIL" = true ]; then echo 'GitHub unavailable' >&2; exit 1; fi
if [[ "$2" = */check-runs ]]; then echo '{"check_runs":[]}'; exit 0; fi
if [[ "$2" = */reviews || "$2" = */comments ]]; then echo '[]'; exit 0; fi
if [[ "$2" = */status ]]; then
  if [ -f "$WOKE" ]; then echo success; else echo pending; fi; exit 0
fi
if [[ "$2" = */commits/* ]]; then echo website/index.md; exit 0; fi
n=$(cat "$READ_COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$READ_COUNT"
merged=false; [ "$n" -lt "$MERGE_ON_READ" ] || merged=true
printf '{"merged":%s,"state":"%s","head":{"sha":"head-1"}}\\n' "$merged" "$MOCK_PR_STATE"`);
  script("sleep", 'echo "sleep $*" >> "$CALL_LOG"; exit 0');
  script("curl", 'echo "curl $*" >> "$CALL_LOG"; echo 200');
  script("catalyst-events", 'echo "retired CLI" >> "$CALL_LOG"; exit 70');
  try {
    let code = options.code ?? example(path);
    if (options.twice) code += `\n${code}`;
    const start = performance.now();
    const result = spawnSync("bash", ["-c", code], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`, HOME: dir, CALL_LOG: log, WOKE: join(dir, "woke"),
        WAIT_COUNT: join(dir, "waits"), READ_COUNT: join(dir, "reads"),
        pr_number: "123", ticket: "CTC-1234", MOCK_PR_STATE: options.closed ? "closed" : "open",
        MERGE_ON_READ: String(options.mergeOnRead ?? 2), MOCK_WAIT_RC: String(options.waitRc ?? 0),
        EVENTS_JSON: JSON.stringify(options.events ?? [{ sequence: 41, type: "github.pr.merged" }]),
        STATUS_JSON: JSON.stringify(options.status ?? { head: 40, reachable: true }),
        STATUS_FAIL: String(options.statusFail ?? false), FAIL_AFTER_WAIT: String(options.failAfterWait ?? false),
        GH_FAIL: String(options.ghFail ?? false), REPO_NAME: options.repo ?? "coalesce-labs/example",
      }, encoding: "utf8", timeout: 5000,
    });
    const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    return { ...result, calls, elapsedMs: performance.now() - start };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const waits = (result) => result.calls.filter((call) => call.startsWith("catalyst events wait-for "));
const reads = (result) => result.calls.filter((call) => call === "gh api repos/coalesce-labs/example/pulls/123");
const sleeps = (result) => result.calls.filter((call) => call.startsWith("sleep "));

// The published Bash examples are the executable seam, rather than a test-only reimplementation.
test("create-pr wakes on a cloud merge and confirms it without sleeping", () => {
  const result = runExample(monitoring);
  expect(result.calls).toContain("catalyst events status --json");
  expect(result.status).toBe(0);
  expect(waits(result)).toHaveLength(1);
  expect(reads(result)).toHaveLength(2); // Initial snapshot, then one read on the wake.
  expect(sleeps(result)).toEqual([]);
  expect(result.calls).not.toContain("retired CLI");
  expect(result.stdout).toContain("MERGED");
  expect(result.elapsedMs).toBeLessThan(60000);
});

test("merge-pr wakes on a completed check suite and rereads the PR once", () => {
  const result = runExample(blocker, { mergeOnRead: 999, events: [{ sequence: 41, type: "github.check-suite.completed" }] });
  expect(result.status).toBe(0);
  expect(waits(result)).toHaveLength(1);
  expect(reads(result)).toHaveLength(2);
  expect(sleeps(result)).toEqual([]);
  expect(result.stdout).toContain("github.check-suite.completed");
});

for (const path of [monitoring, blocker]) {
  for (const type of ["github.pr-review.submitted", "github.pr-review-comment.created", "github.pr-review-thread.resolved", "github.issue-comment.created", "github.push"]) {
    test(`${path}: ${type} wakes once without sleeping`, () => {
      const result = runExample(path, { mergeOnRead: 999, events: [{ sequence: 41, type }] });
      expect(result.status).toBe(0);
      expect(reads(result)).toHaveLength(2);
      expect(waits(result)).toHaveLength(1);
      expect(sleeps(result)).toEqual([]);
      expect(result.stdout).toContain(type);
    });
  }
  test(`${path}: unrelated event advances the cursor without a GitHub read`, () => {
    const result = runExample(path, { events: [{ sequence: 41, type: "relay.phase.completed" }, { sequence: 42, type: "github.pr.merged" }] });
    expect(result.status).toBe(0);
    expect(waits(result)).toEqual([
      "catalyst events wait-for --after 40 --timeout 300",
      "catalyst events wait-for --after 41 --timeout 300",
    ]);
    expect(reads(result)).toHaveLength(2);
    expect(sleeps(result)).toEqual([]);
  });
  test(`${path}: a resume after a push retains the prior cursor`, () => {
    const result = runExample(path, { twice: true, mergeOnRead: 4, events: [{ sequence: 41, type: "github.check-suite.completed" }, { sequence: 42, type: "github.pr.merged" }] });
    expect(result.status).toBe(0);
    expect(waits(result)[1]).toContain("--after 41");
    expect(result.stdout).toContain("MERGED");
  });
  test(`${path}: timeout rereads once and keeps the cloud wait`, () => {
    const result = runExample(path, { waitRc: 1 });
    expect(result.status).toBe(0);
    expect(reads(result)).toHaveLength(2);
    expect(sleeps(result)).toEqual([]);
    expect(result.stdout).toContain("MERGED");
  });
  for (const options of [{ absent: true }, { statusFail: true }]) {
    test(`${path}: unavailable cloud uses a bounded REST fallback with one reason`, () => {
      const result = runExample(path, { ...options, mergeOnRead: 4 });
      expect(result.status).toBe(0);
      expect(waits(result)).toEqual([]);
      expect(sleeps(result)).toHaveLength(2);
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      expect(result.stderr).toContain(options.absent ? "CLI absent" : "status failed");
      expect(result.stdout).toContain("MERGED");
    });
  }
  test(`${path}: a fallback ceiling reports PENDING and exits nonzero`, () => {
    const result = runExample(path, { absent: true, mergeOnRead: 999 });
    expect(result.status).toBe(1);
    expect(reads(result)).toHaveLength(25); // Snapshot plus at most 24 fallback reads.
    expect(sleeps(result)).toHaveLength(23);
    expect(result.stdout).toContain("PENDING");
  });
  test(`${path}: wait errors do not permit sleeping while status succeeds`, () => {
    const result = runExample(path, { waitRc: 4 });
    expect(result.status).toBe(1);
    expect(sleeps(result)).toEqual([]);
    expect(reads(result)).toHaveLength(1);
    expect(result.stderr).toContain("cloud wait failed");
  });
  test(`${path}: an outage falls back only after a failed status probe`, () => {
    const result = runExample(path, { waitRc: 4, failAfterWait: true, mergeOnRead: 4 });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("status failed after wait error");
    expect(sleeps(result)).toHaveLength(1);
  });
  test(`${path}: interruption stops without a fallback`, () => {
    const result = runExample(path, { waitRc: 130 });
    expect(result.status).toBe(130);
    expect(sleeps(result)).toEqual([]);
  });
  test(`${path}: REST errors cannot become OPEN or MERGED`, () => {
    const result = runExample(path, { ghFail: true });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("MERGED");
    expect(waits(result)).toEqual([]);
  });
  test(`${path}: malformed status cannot start an unverified wait`, () => {
    const result = runExample(path, { status: { reachable: true } });
    expect(result.status).toBe(1);
    expect(waits(result)).toEqual([]);
    expect(sleeps(result)).toEqual([]);
  });
  test(`${path}: a closed PR stops without claiming merge`, () => {
    const result = runExample(path, { closed: true, mergeOnRead: 999 });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("CLOSED");
    expect(result.stdout).not.toContain("MERGED");
  });
}

test("deployment verification waits through the cloud when it is available", () => {
  const path = "skills/merge-pr/references/post-merge-deploy-verify.md";
  const result = runExample(path, { repo: "coalesce-labs/catalyst", events: [{ sequence: 41, type: "github.deployment-status.success" }], code: `${example(path)}\nverify_post_merge_deploy merge-sha` });
  expect(result.status).toBe(0);
  expect(waits(result)).toHaveLength(1);
  expect(sleeps(result)).toEqual([]);
  expect(result.stdout).toContain("DEPLOYED");
});


test("merge SHA readback uses a cloud wait instead of a sleep retry", () => {
  const path = "skills/merge-pr/references/ci-fixup-and-behind.md";
  const retry = [...readFileSync(new URL(path, root), "utf8").matchAll(/```bash\n([\s\S]*?)```/g)][1][1];
  const result = runExample(path, { code: `REPO=coalesce-labs/example; PR_NUMBER=123\n${retry}` });
  expect(result.status).toBe(0);
  expect(waits(result)).toHaveLength(1);
  expect(sleeps(result)).toEqual([]);
});
