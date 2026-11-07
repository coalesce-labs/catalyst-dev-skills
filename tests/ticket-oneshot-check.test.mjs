import { test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkVerdict, expandCheck, failuresIn } from "../skills/ticket-oneshot/scripts/check.mjs";
import { scanDiff, unrecorded } from "../skills/ticket-oneshot/scripts/scan-shortcuts.mjs";
import { reviewDepth } from "../skills/ticket-oneshot/scripts/review-step.mjs";

const STAGE = resolve(import.meta.dir, "../skills/ticket-oneshot/scripts/stage");
let root, repo, artifacts;
const git = (...args) => { const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const stage = (args, env = {}) => {
  const clean = { ...process.env, CATALYST_TICKET: "CTC-1", CATALYST_ARTIFACT_DIR: artifacts, CATALYST_REPOSITORY: "demo", ...env };
  if (!("CATALYST_PHASE" in env)) delete clean.CATALYST_PHASE;
  delete clean.CATALYST_CHECK_COMMAND;
  return spawnSync("node", [STAGE, ...args], { cwd: repo, encoding: "utf8", env: clean });
};
const marker = (name, stageName) => { mkdirSync(join(artifacts, "stages"), { recursive: true }); writeFileSync(join(artifacts, "stages", name), JSON.stringify({ stage: stageName, attempt: 1, at: new Date().toISOString(), ticket: "CTC-1" })); };
const atImplement = () => { for (const s of ["research", "plan"]) { marker(`1-${s}.start.json`, s); marker(`1-${s}.done.json`, s); } expect(stage(["start", "implement"]).status).toBe(0); writeFileSync(join(artifacts, "implement.md"), "# notes\n"); };
const scripts = (body) => writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "demo", scripts: body }));
const commit = (message) => { git("add", "-A"); git("-c", "core.hooksPath=/dev/null", "commit", "-qm", message); };
/** A check that fails naming a test while the file `broken` exists. */
const FAILS_WHILE_BROKEN = `test -f broken && echo '(fail) the broken test' && exit 1; exit 0`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "oneshot-check-"));
  repo = join(root, "repo"); artifacts = join(root, "artifacts"); mkdirSync(repo); mkdirSync(artifacts);
  spawnSync("git", ["init", "-q", "--bare", join(root, "origin.git")]);
  git("init", "-q", "-b", "main"); git("config", "user.email", "t@t.invalid"); git("config", "user.name", "t");
  writeFileSync(join(repo, "run.sh"), FAILS_WHILE_BROKEN);
  scripts({ check: "bun run first && bun run second", first: "true", second: "bash run.sh" });
  commit("base");
  git("remote", "add", "origin", join(root, "origin.git")); git("push", "-q", "origin", "main"); git("fetch", "-q", "origin");
  git("checkout", "-qb", "CTC-1");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A validation report at validation.md, with the plan it answers. */
const atValidate = ({ rows = "| AC1 | met | run.sh:1 |\n| AC2 | met | run.sh:1 |", verdict = "PASS" } = {}) => {
  writeFileSync(join(artifacts, "plan.md"), "## Acceptance criteria\n- **AC1** one\n- **AC2** two\n");
  const steps = ["plan-conformance", "type-safety", "code-review", "security-review", "security-audit"].map((step, i) => ({ step, verdict: i === 0 ? verdict : "SKIPPED", detail: "d" }));
  writeFileSync(join(artifacts, "validation.md"), `---\nsource_ticket: CTC-1\nrepository: demo\n---\n\n# Report\n\n## Requirements\n\n${rows}\n\nSee \`run.sh:1\`.\n\n## Validation Source\n\nAC9 is not a requirement row.\n\n\`\`\`catalyst-validation-ladder\n${JSON.stringify({ version: 1, steps })}\n\`\`\`\n`);
};
const pastImplement = () => { atImplement(); writeFileSync(join(repo, "change.txt"), "x"); commit("change"); expect(stage(["check"]).status).toBe(0); expect(stage(["done", "implement"]).status).toBe(0); expect(stage(["start", "validate"]).status).toBe(0); };

test("validate finishes when every plan criterion is accounted for and the check is green", () => {
  pastImplement(); atValidate();
  expect(stage(["done", "validate"]).status).toBe(0);
  expect(stage(["next"]).stdout.trim()).toBe("pr");
});

test("validate is refused when the report skips a plan criterion, even if it names it elsewhere", () => {
  pastImplement(); atValidate({ rows: "| AC1 | met | run.sh:1 |" });
  writeFileSync(join(artifacts, "validation.md"), readFileSync(join(artifacts, "validation.md"), "utf8").replace("AC9 is not", "AC2 is not"));
  const refused = stage(["done", "validate"]);
  expect(refused.status).not.toBe(0);
  expect(refused.stderr).toContain("does not account for AC2");
});

test("validate is refused when it found a requirement unmet", () => {
  pastImplement(); atValidate({ verdict: "FAIL" });
  const refused = stage(["done", "validate"]);
  expect(refused.status).not.toBe(0);
  expect(refused.stderr).toContain("plan-conformance is FAIL");
});

test("validate cannot skip its own question", () => {
  pastImplement(); atValidate({ verdict: "SKIPPED" });
  const refused = stage(["done", "validate"]);
  expect(refused.status).not.toBe(0);
  expect(refused.stderr).toContain("plan-conformance is SKIPPED");
});

test("validate is refused when the code moved after the last green check", () => {
  pastImplement(); atValidate();
  writeFileSync(join(repo, "later.txt"), "x"); commit("a fix with no check");
  expect(stage(["done", "validate"]).status).not.toBe(0);
});

test("a chain becomes one step per link, through named scripts and a wrapper", () => {
  const all = { check: "wrap -- bun run a && wrap -- bun run b", a: "bun run x && CI=1 bun run y", b: "bun build", x: "tsc", y: "lint" };
  expect(expandCheck("bun run check", all)).toEqual(["wrap -- bun run x", "wrap -- env CI=1 bun run y", "wrap -- bun run b"]);
  expect(expandCheck("env -u CLAUDECODE bun run a", all)).toEqual(["env -u CLAUDECODE bun run x", "env -u CLAUDECODE env CI=1 bun run y"]);
});

test("a chain with shell syntax that cannot be split safely stays one step", () => {
  expect(expandCheck("bun run a", { a: "x && bash -c 'y && z'" })).toEqual(["bun run a"]);
});

test("failing names come from fail lines and skip passing tests that mention FAIL", () => {
  const log = ["\x1b[31m(fail) one > breaks [1.20ms]\x1b[0m", "(pass) shows (fail) in its title", "pkg:test:  FAIL  test/a.test.ts > two", "FAIL  harness.codex  none found", "src/a.ts(3,1): error TS2322: nope"].join("\n");
  expect(failuresIn(log)).toEqual(["one > breaks", "src/a.ts(3,1): error TS2322: nope", "test/a.test.ts > two"]);
});

test("the verdict is proven only when every failing test also failed at base", () => {
  const head = { steps: [{ step: "s", exit: 1, failures: ["t1", "t2"] }] };
  expect(checkVerdict(head, null).ok).toBe(false);
  expect(checkVerdict(head, { steps: [{ step: "s", exit: 0, failures: [] }] }).unproven[0].reason).toContain("green at base");
  expect(checkVerdict(head, { steps: [{ step: "s", exit: 1, failures: ["t1"] }] }).unproven[0].failures).toEqual(["t2"]);
  expect(checkVerdict(head, { steps: [{ step: "s", exit: 1, failures: ["t1", "t2"] }] }).ok).toBe(true);
  expect(checkVerdict({ steps: [{ step: "s", exit: 1, failures: [] }] }, { steps: [{ step: "s", exit: 1, failures: [] }] }).ok).toBe(false);
});

test("implement cannot be marked done with no check record, whatever implement.md says", () => {
  atImplement();
  writeFileSync(join(artifacts, "implement.md"), "Exit code: 0, all green\n");
  const done = stage(["done", "implement"]);
  expect(done.status).toBe(1);
  expect(done.stderr).toContain("no check record");
  expect(existsSync(join(artifacts, "stages/1-implement.done.json"))).toBe(false);
});

test("implement cannot be marked done with no implement.md when there is no runner", () => {
  for (const s of ["research", "plan"]) { marker(`1-${s}.start.json`, s); marker(`1-${s}.done.json`, s); }
  stage(["start", "implement"]);
  expect(stage(["check"]).status).toBe(0);
  expect(stage(["done", "implement"]).stderr).toContain("missing stage artifact");
});

test("a green check lets implement finish and the marker records it", () => {
  atImplement();
  expect(stage(["check"]).status).toBe(0);
  expect(stage(["done", "implement"]).status).toBe(0);
  const done = JSON.parse(readFileSync(join(artifacts, "stages/1-implement.done.json"), "utf8"));
  expect(done.check.green).toBe(true);
});

test("a record is for one exact tree: a change after the check needs a new check", () => {
  atImplement();
  expect(stage(["check"]).status).toBe(0);
  writeFileSync(join(repo, "later.txt"), "x");
  expect(stage(["done", "implement"]).stderr).toContain("no check record");
});

test("committing after the check keeps the record valid, since the tree is the same", () => {
  atImplement();
  writeFileSync(join(repo, "change.txt"), "x");
  expect(stage(["check"]).status).toBe(0);
  commit("change");
  expect(stage(["done", "implement"]).status).toBe(0);
});

test("a red step does not hide the steps after it", () => {
  scripts({ check: "bun run first && bun run second", first: "false", second: "echo second-ran" });
  commit("red first");
  atImplement();
  const check = stage(["check"]);
  expect(check.status).toBe(1);
  expect(check.stdout).toContain("RED   bun run first");
  expect(check.stdout).toContain("ok    bun run second");
});

test("red caused by this change is refused: green at base", () => {
  atImplement();
  writeFileSync(join(repo, "broken"), ""); commit("break it");
  expect(stage(["check"]).status).toBe(1);
  expect(stage(["done", "implement"]).stderr).toContain("run `stage check --base`");
  const base = stage(["check", "--base"]);
  expect(base.status).toBe(1);
  expect(base.stderr).toContain("green at base");
  expect(stage(["done", "implement"]).status).toBe(1);
});

test("red that fails the same way at base passes, and the pull request says so from the record", () => {
  git("checkout", "-q", "main"); writeFileSync(join(repo, "broken"), ""); commit("main is already red"); git("push", "-q", "origin", "main"); git("fetch", "-q", "origin");
  git("checkout", "-q", "CTC-1"); git("merge", "-q", "--ff-only", "main");
  atImplement();
  writeFileSync(join(repo, "change.txt"), "x"); commit("change");
  expect(stage(["check"]).status).toBe(1);
  expect(stage(["check", "--base"]).status).toBe(0);
  expect(stage(["done", "implement"]).status).toBe(0);
  expect(git("worktree", "list").split("\n").length).toBe(1);
  marker("1-validate.start.json", "validate"); marker("1-validate.done.json", "validate");
  expect(stage(["start", "pr"]).status).toBe(0);
  writeFileSync(join(artifacts, "pr.md"), "Title\n\nAll tests, lint and format passed.\n");
  expect(stage(["done", "pr"]).status).toBe(0);
  const pr = readFileSync(join(artifacts, "pr.md"), "utf8");
  expect(pr).toContain("Red, and not caused by this change");
  expect(pr).toContain("the broken test");
});

test("green on the retry is recorded as flaky and is not red", () => {
  writeFileSync(join(repo, "run.sh"), `test -f ${root}/seen && exit 0; touch ${root}/seen; echo '(fail) wobbly'; exit 1`);
  commit("flaky");
  atImplement();
  expect(stage(["check"]).stdout).toContain("flaky");
  expect(stage(["done", "implement"]).status).toBe(0);
  expect(JSON.parse(readFileSync(join(artifacts, "stages/1-implement.done.json"), "utf8")).check.flaky[0].failures).toEqual(["wobbly"]);
});

test("in a phase the runner holds the gate, so no record or implement.md is needed", () => {
  for (const s of ["research", "plan"]) { marker(`1-${s}.start.json`, s); marker(`1-${s}.done.json`, s); }
  stage(["start", "implement"], { CATALYST_PHASE: "implement" });
  expect(stage(["done", "implement"], { CATALYST_PHASE: "implement" }).status).toBe(0);
});

test("the scan reports added lines with their real line numbers", () => {
  const diff = "+++ b/a.ts\n@@ -0,0 +7,2 @@\n+const ok = 1;\n+const x = y as any;\n+++ b/t.test.ts\n@@ -1 +1 @@\n-old\n+test.only(\"x\", () => {});\n";
  expect(scanDiff(diff).map((h) => [h.file, h.line, h.pattern])).toEqual([["a.ts", 8, "any cast"], ["t.test.ts", 1, "skipped or focused test"]]);
  expect(unrecorded([{ file: "a.ts", line: 8 }], [{ path: "a.ts", line: 8 }])).toEqual([]);
  expect(unrecorded([{ file: "a.ts", line: 8 }], [{ path: "a.ts", line: 9 }])).toHaveLength(1);
});

test("review cannot finish until every scan hit is a recorded finding", () => {
  atImplement();
  expect(stage(["check"]).status).toBe(0);
  expect(stage(["done", "implement"]).status).toBe(0);
  const base = git("rev-parse", "origin/main");
  writeFileSync(join(repo, "a.ts"), "const x = y as any;\n"); commit("shortcut");
  const head = git("rev-parse", "HEAD");
  marker("1-validate.start.json", "validate"); marker("1-validate.done.json", "validate");
  stage(["start", "pr"]); writeFileSync(join(artifacts, "pr.md"), "T\n");
  marker("1-pr.done.json", "pr");
  expect(stage(["start", "review"]).status).toBe(0);
  const result = (findings) => writeFileSync(join(artifacts, "review-result.json"), JSON.stringify({ version: 1, reviewed_head: head, final_head: head, base, gates: [{ step: "security-review", verdict: "SKIPPED", reason: "this test is about the scan" }, { step: "code-review", verdict: "FAIL" }, { step: "type-safety", verdict: "FAIL" }], findings }));
  for (const [skill, step] of [["review-code", "code-review"], ["validate-type-safety", "type-safety"]]) {
    expect(stage(["review-step", skill, "--base", base], { CATALYST_REVIEW_SESSION_CMD: `cat >/dev/null; printf '\`\`\`catalyst-review-step\\n{"step":"${step}","verdict":"FAIL","detail":"d"}\\n\`\`\`\\n'` }).status).toBe(0);
  }
  result([]);
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("a.ts:1 any cast");
  result([{ id: "F1", path: "a.ts", line: 1, verdict: "invalid", reason: "fixture" }]);
  expect(stage(["done", "review"]).status).toBe(0);
});

// A review gate that claims a verdict needs the session that produced it. A fake session stands in
// for the harness: it reads the prompt on stdin and prints a report ending in its verdict.
const SCOPE = (skill) => resolve(import.meta.dir, `../skills/${skill}/scripts/review-scope.sh`);
const atReview = () => {
  atImplement();
  writeFileSync(join(repo, "a.ts"), "export const x = 1;\n"); commit("change");
  expect(stage(["check"]).status).toBe(0);
  expect(stage(["done", "implement"]).status).toBe(0);
  marker("1-validate.start.json", "validate"); marker("1-validate.done.json", "validate");
  stage(["start", "pr"]); writeFileSync(join(artifacts, "pr.md"), "T\n");
  marker("1-pr.done.json", "pr");
  expect(stage(["start", "review"]).status).toBe(0);
  const base = git("merge-base", "origin/main", "HEAD");
  const head = git("rev-parse", "HEAD");
  const result = (gates, overrides = {}) => writeFileSync(join(artifacts, "review-result.json"), JSON.stringify({ version: 1, reviewed_head: head, final_head: head, base, gates, findings: [], ...overrides }));
  const session = (step, verdict, { extra = "" } = {}) => {
    return `cat > ${join(root, "prompt.txt")}; ${extra} printf 'report\\n\`\`\`catalyst-review-step\\n{"step":"${step}","verdict":"${verdict}","detail":"d"}\\n\`\`\`\\n'`;
  };
  const reviewStep = (skill, step, verdict, options = {}) => stage(["review-step", skill, "--base", base], { CATALYST_REVIEW_SESSION_CMD: session(step, verdict, options) });
  const scope = (skill) => spawnSync("bash", [SCOPE(skill), "--base", "origin/main"], { cwd: repo, encoding: "utf8", env: { ...process.env, CATALYST_ARTIFACT_DIR: artifacts } });
  return { base, head, result, reviewStep, scope };
};
const TYPES_OK = { step: "type-safety", verdict: "SKIPPED" };

test("a code review PASS with no session behind it is refused", () => {
  const { result } = atReview();
  result([{ step: "code-review", verdict: "PASS" }]);
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("code-review is PASS but review-code never ran in its own session");
  expect(existsSync(join(artifacts, "stages/1-review.done.json"))).toBe(false);
});

test("running only the scope script does not earn a PASS", () => {
  const { result, scope } = atReview();
  expect(scope("review-security").status).toBe(0);
  result([{ step: "security-review", verdict: "PASS" }]);
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("security-review is PASS but review-security never ran in its own session");
});

test("a review step's session gets the skill's whole text, and its verdict lets the same PASS through", () => {
  const { head, result, reviewStep } = atReview();
  const ran = reviewStep("review-security", "security-review", "PASS");
  expect(ran.status).toBe(0);
  const prompt = readFileSync(join(root, "prompt.txt"), "utf8");
  for (const file of ["review-security/SKILL.md", "review-security/references/method.md", "review-security/references/categories.md", "review-security/references/report.md"]) {
    const text = readFileSync(resolve(import.meta.dir, "../skills", file), "utf8");
    expect(prompt).toContain(text.split("\n").filter((line) => line.length > 40 && !line.includes("CLAUDE_SKILL_DIR") && !line.includes("$ARGUMENTS")).at(-1));
    expect(prompt).toContain(`<file path="${file}">`);
  }
  expect(prompt).not.toContain("${CLAUDE_SKILL_DIR}");
  const receipt = JSON.parse(readFileSync(join(artifacts, "reviews", `review-security-${head}.json`), "utf8"));
  expect(receipt).toMatchObject({ skill: "review-security", step: "security-review", verdict: "PASS", head });
  expect(existsSync(join(artifacts, "reviews", `review-security-${head}.md`))).toBe(true);
  expect(reviewStep("review-code", "code-review", "PASS").status).toBe(0);
  result([{ step: "code-review", verdict: "PASS" }, { step: "security-review", verdict: "PASS" }, { step: "type-safety", verdict: "PASS" }]);
  expect(stage(["done", "review"]).status).toBe(1);
  expect(reviewStep("validate-type-safety", "type-safety", "PASS").status).toBe(0);
  expect(readFileSync(join(root, "prompt.txt"), "utf8")).toContain('<file path="scan-reward-hacking/SKILL.md">');
  expect(stage(["done", "review"]).status).toBe(0);
});

test("a security session does not stand in for code review", () => {
  const { result, reviewStep } = atReview();
  expect(reviewStep("review-security", "security-review", "PASS").status).toBe(0);
  result([{ step: "code-review", verdict: "PASS" }, { step: "security-review", verdict: "PASS" }]);
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("code-review is PASS but review-code never ran");
  expect(refused.stderr).not.toContain("security-review is PASS");
});

test("a gate cannot say PASS when its session reported FAIL", () => {
  const { result, reviewStep } = atReview();
  expect(reviewStep("review-code", "code-review", "FAIL").status).toBe(0);
  result([{ step: "code-review", verdict: "PASS" }]);
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("code-review says PASS, and its session reported FAIL");
});

test("a session for another base is refused", () => {
  const { head, result, reviewStep } = atReview();
  expect(reviewStep("review-code", "code-review", "FAIL").status).toBe(0);
  result([{ step: "code-review", verdict: "FAIL" }], { base: head });
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("ran against base");
});

test("the script runs the scope step itself and gives the session its output", () => {
  const { reviewStep, head, base } = atReview();
  expect(reviewStep("review-code", "code-review", "PASS").status).toBe(0);
  expect(existsSync(join(artifacts, "gates", `review-code-${head}.json`))).toBe(true);
  expect(readFileSync(join(root, "prompt.txt"), "utf8")).toContain("Its scope step already ran");
  expect(readFileSync(join(root, "prompt.txt"), "utf8")).toContain("status: review");
  expect(base).toBeTruthy();
});

test("with nothing to review the step records SKIPPED and starts no session", () => {
  const { head } = atReview();
  const ran = stage(["review-step", "review-security", "--base", head], { CATALYST_REVIEW_SESSION_CMD: "cat >/dev/null; exit 9" });
  expect(ran.status).toBe(0);
  expect(ran.stdout).toContain("security-review SKIPPED");
  expect(JSON.parse(readFileSync(join(artifacts, "reviews", `review-security-${head}.json`), "utf8")).verdict).toBe("SKIPPED");
});

test("a failing session reports what it said on stdout, past a warning on stderr", () => {
  const { base } = atReview();
  const ran = stage(["review-step", "review-code", "--base", base], { CATALYST_REVIEW_SESSION_CMD: "cat >/dev/null; echo 'the real cause'; echo 'only a warning' >&2; exit 3" });
  expect(ran.status).toBe(1);
  expect(ran.stderr).toContain("the real cause");
  expect(ran.stderr).toContain("only a warning");
});

test("a session that cannot sign in says so, and says what to do", () => {
  const { base } = atReview();
  const ran = stage(["review-step", "review-code", "--base", base], { CATALYST_REVIEW_SESSION_CMD: "cat >/dev/null; echo 'Not logged in'; exit 1" });
  expect(ran.status).toBe(1);
  expect(ran.stderr).toContain("CATALYST_REVIEW_SESSION_CMD");
});

test("a session with no verdict or a changed checkout earns no receipt", () => {
  const { head, base, reviewStep } = atReview();
  const silent = stage(["review-step", "review-code", "--base", base], { CATALYST_REVIEW_SESSION_CMD: "cat >/dev/null; echo looks fine" });
  expect(silent.status).toBe(1);
  expect(silent.stderr).toContain("no catalyst-review-step block");
  const edits = reviewStep("review-code", "code-review", "PASS", { extra: `echo x > ${join(repo, "edited.txt")};` });
  expect(edits.status).toBe(1);
  expect(edits.stderr).toContain("changed the checkout");
  rmSync(join(repo, "edited.txt"));
  const broken = stage(["review-step", "review-code", "--base", base], { CATALYST_REVIEW_SESSION_CMD: "cat >/dev/null; exit 3" });
  expect(broken.status).toBe(1);
  expect(broken.stderr).toContain("the review session failed");
  expect(existsSync(join(artifacts, "reviews", `review-code-${head}.json`))).toBe(false);
});

test("a skipped gate is refused where the review owed it", () => {
  const { result } = atReview();
  result([{ step: "code-review", verdict: "SKIPPED", reason: "no time" }, { step: "type-safety", verdict: "SKIPPED" }, { step: "security-review", verdict: "SKIPPED" }], { depth: "deep" });
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("code-review is SKIPPED, and the diff has code to review");
  expect(refused.stderr).toContain("type-safety is SKIPPED, and the diff touches TypeScript");
  expect(refused.stderr).toContain("security-review is SKIPPED, and a deep review always runs it");
});

test("a light review may skip security, with no session", () => {
  const { result, reviewStep } = atReview();
  expect(reviewStep("review-code", "code-review", "PASS").status).toBe(0);
  expect(reviewStep("validate-type-safety", "type-safety", "PASS").status).toBe(0);
  result([{ step: "code-review", verdict: "PASS" }, { step: "type-safety", verdict: "PASS" }, { step: "security-review", verdict: "SKIPPED", detail: "light, no listed surface" }], { depth: "light" });
  expect(stage(["done", "review"]).status).toBe(0);
});

test("committed fixes need a recheck session on the fix range", () => {
  const { head, result, reviewStep } = atReview();
  expect(reviewStep("review-code", "code-review", "FAIL").status).toBe(0);
  expect(reviewStep("validate-type-safety", "type-safety", "PASS").status).toBe(0);
  writeFileSync(join(repo, "a.ts"), "export const x = 2;\n"); commit("fix");
  const final = git("rev-parse", "HEAD");
  expect(stage(["check"]).status).toBe(0);
  result([{ step: "code-review", verdict: "FAIL" }, TYPES_OK], { final_head: final });
  let refused = stage(["done", "review"]);
  expect(refused.stderr).toContain("records no recheck gate");
  const findings = [{ id: "F1", verdict: "valid", fix: { sha: final } }];
  result([{ step: "code-review", verdict: "FAIL" }, { step: "type-safety", verdict: "PASS" }, { step: "recheck", verdict: "PASS" }], { final_head: final, findings });
  refused = stage(["done", "review"]);
  expect(refused.stderr).toContain("with no review-code session on the fix range");
  const fixRange = stage(["review-step", "review-code", "--base", head], { CATALYST_REVIEW_SESSION_CMD: `cat >/dev/null; printf '\`\`\`catalyst-review-step\\n{"step":"code-review","verdict":"PASS","detail":"d"}\\n\`\`\`\\n'` });
  expect(fixRange.status).toBe(0);
  expect(stage(["done", "review"]).status).toBe(0);
});

test("type safety PASS also needs a green recorded check of the tree under review", () => {
  const { base, result } = atReview();
  writeFileSync(join(repo, "b.ts"), "export const y = 2;\n"); commit("after the check");
  // HEAD moved, so the review must name the new head; the old check record is for another tree.
  const head = git("rev-parse", "HEAD");
  const ran = stage(["review-step", "validate-type-safety", "--base", base], { CATALYST_REVIEW_SESSION_CMD: `cat >/dev/null; printf '\`\`\`catalyst-review-step\\n{"step":"type-safety","verdict":"PASS","detail":"d"}\\n\`\`\`\\n'` });
  expect(ran.status).toBe(0);
  expect(stage(["review-step", "review-code", "--base", base], { CATALYST_REVIEW_SESSION_CMD: `cat >/dev/null; printf '\`\`\`catalyst-review-step\\n{"step":"code-review","verdict":"PASS","detail":"d"}\\n\`\`\`\\n'` }).status).toBe(0);
  result([{ step: "type-safety", verdict: "PASS" }, { step: "code-review", verdict: "PASS" }], { reviewed_head: head, final_head: head });
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("type-safety is PASS but the full check is not recorded green");
  expect(stage(["check"]).status).toBe(0);
  expect(stage(["done", "review"]).status).toBe(0);
});

// The scripts that produce a stage's evidence must be the ones it started with.
const SKILLS = resolve(import.meta.dir, "../skills");
const copySkills = () => { const copy = join(root, "skills"); spawnSync("cp", ["-R", SKILLS, copy]); return copy; };
const stageFrom = (skills, args) => {
  const env = { ...process.env, CATALYST_TICKET: "CTC-1", CATALYST_ARTIFACT_DIR: artifacts, CATALYST_REPOSITORY: "demo" };
  delete env.CATALYST_PHASE; delete env.CATALYST_CHECK_COMMAND;
  return spawnSync("node", [join(skills, "ticket-oneshot/scripts/stage"), ...args], { cwd: repo, encoding: "utf8", env });
};
const atImplementFrom = (skills) => { for (const s of ["research", "plan"]) { marker(`1-${s}.start.json`, s); marker(`1-${s}.done.json`, s); } expect(stageFrom(skills, ["start", "implement"]).status).toBe(0); writeFileSync(join(artifacts, "implement.md"), "# notes\n"); };

test("the check runs when thoughts is gitignored, and thoughts stays out of the tree", () => {
  writeFileSync(join(repo, ".gitignore"), "thoughts/\n"); commit("ignore thoughts");
  mkdirSync(join(repo, "thoughts")); writeFileSync(join(repo, "thoughts", "note.md"), "x\n");
  atImplement();
  const checked = stage(["check"]);
  expect(checked.stderr).not.toContain("ignored");
  expect(checked.status).toBe(0);
  expect(stage(["done", "implement"]).status).toBe(0);
});

test("a skills change during a stage voids its done", () => {
  const skills = copySkills();
  atImplementFrom(skills);
  expect(stageFrom(skills, ["check"]).status).toBe(0);
  writeFileSync(join(skills, "ticket-oneshot/scripts/check.mjs"), readFileSync(join(skills, "ticket-oneshot/scripts/check.mjs"), "utf8") + "\n// patched\n");
  const refused = stageFrom(skills, ["done", "implement"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("the skills changed during stage implement");
});

test("a check recorded by changed scripts is refused even after they are restored", () => {
  const skills = copySkills();
  atImplementFrom(skills);
  const file = join(skills, "ticket-oneshot/scripts/check.mjs");
  const original = readFileSync(file, "utf8");
  writeFileSync(file, original + "\n// patched\n");
  expect(stageFrom(skills, ["check"]).status).toBe(0);
  writeFileSync(file, original);
  const refused = stageFrom(skills, ["done", "implement"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("written by different stage scripts");
  expect(stageFrom(skills, ["check"]).status).toBe(0);
  expect(stageFrom(skills, ["done", "implement"]).status).toBe(0);
});

test("a copy of the stage scripts run from elsewhere cannot finish a stage the shipped ones started", () => {
  const skills = copySkills();
  atImplementFrom(skills);
  const elsewhere = join(root, "patched"); spawnSync("cp", ["-R", skills, elsewhere]);
  expect(stageFrom(elsewhere, ["check"]).status).toBe(0);
  const refused = stageFrom(elsewhere, ["done", "implement"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("the skills changed during stage implement");
});

// What the diff owes comes from the diff, whatever the result file lists or says.
const LIGHT_PASS = [{ step: "code-review", verdict: "PASS" }, { step: "type-safety", verdict: "PASS" }, { step: "security-review", verdict: "SKIPPED" }];

test("leaving out a gate the diff owes is refused like skipping it", () => {
  const { result } = atReview();
  result([{ step: "plan-conformance", verdict: "PASS" }], { depth: "deep" });
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("security-review is missing, and a deep review always runs it");
  expect(refused.stderr).toContain("type-safety is missing, and the diff touches TypeScript");
  expect(refused.stderr).toContain("code-review is missing, and the diff has code to review");
});

const onDeepPath = () => {
  const at = atReview();
  mkdirSync(join(repo, "auth"), { recursive: true });
  writeFileSync(join(repo, "auth/login.ts"), "export const y = 1;\n");
  commit("auth");
  expect(stage(["check"]).status).toBe(0);
  const head = git("rev-parse", "HEAD");
  expect(at.reviewStep("review-code", "code-review", "PASS").status).toBe(0);
  expect(at.reviewStep("validate-type-safety", "type-safety", "PASS").status).toBe(0);
  return { ...at, head };
};

test("a diff on a deep path owes security, whatever the result says its depth is", () => {
  const { head, result } = onDeepPath();
  result(LIGHT_PASS, { depth: "light", reviewed_head: head, final_head: head });
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("the review says light, and the paths it changes make it deep");
  expect(refused.stderr).toContain("security-review is SKIPPED, and a deep review always runs it");
});

test("a diff on a deep path owes security when the result names no depth", () => {
  const { head, result } = onDeepPath();
  result(LIGHT_PASS, { reviewed_head: head, final_head: head });
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("security-review is SKIPPED, and a deep review always runs it");
  expect(refused.stderr).not.toContain("the review says light");
});

const failedReview = (findings) => {
  const { result, reviewStep } = atReview();
  expect(reviewStep("review-code", "code-review", "FAIL").status).toBe(0);
  expect(reviewStep("validate-type-safety", "type-safety", "PASS").status).toBe(0);
  result([{ step: "code-review", verdict: "FAIL" }, { step: "type-safety", verdict: "PASS" }, { step: "security-review", verdict: "SKIPPED" }], { depth: "light", findings });
};

test("a failed review with no finding does not finish the run", () => {
  failedReview([]);
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("code-review is FAIL and the review records no finding for it");
  expect(stage(["next"]).stdout.trim()).toBe("review");
});

test("a failed review finishes when each finding is set aside with a reason", () => {
  failedReview([{ id: "F1", verdict: "invalid", reason: "the path is unreachable" }, { id: "F2", verdict: "deferred", follow_up: "CTC-2" }]);
  expect(stage(["done", "review"]).status).toBe(0);
});

test.each([
  [{ id: "F1", verdict: "valid" }, "finding F1 is valid with no fix commit on this branch"],
  [{ id: "F1", verdict: "valid", fix: { sha: "0".repeat(40) } }, "finding F1 is valid with no fix commit on this branch"],
  [{ id: "F1", verdict: "invalid" }, "finding F1 is invalid with no reason"],
  [{ id: "F1", verdict: "already-fixed" }, "finding F1 is already-fixed with no reason"],
  [{ id: "F1", verdict: "deferred" }, "finding F1 is deferred with no follow_up ticket"],
  [{ id: "F1", verdict: "needs-human", reason: "r" }, "finding F1 needs a person"],
  [{ id: "F1" }, "finding F1 has no verdict"],
])("a finding that has not ended is refused: %j", (finding, message) => {
  failedReview([finding]);
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain(message);
});

const afterFixes = () => {
  const { head, result, reviewStep } = atReview();
  expect(reviewStep("review-code", "code-review", "FAIL").status).toBe(0);
  expect(reviewStep("validate-type-safety", "type-safety", "PASS").status).toBe(0);
  writeFileSync(join(repo, "a.ts"), "export const x = 2;\n"); commit("fix");
  const final = git("rev-parse", "HEAD");
  expect(stage(["check"]).status).toBe(0);
  const recheckSession = (verdict) => stage(["review-step", "review-code", "--base", head], { CATALYST_REVIEW_SESSION_CMD: `cat >/dev/null; printf '\`\`\`catalyst-review-step\\n{"step":"code-review","verdict":"${verdict}","detail":"d"}\\n\`\`\`\\n'` });
  const write = (recheck) => result([{ step: "code-review", verdict: "FAIL" }, { step: "type-safety", verdict: "PASS" }, recheck], { final_head: final, depth: "light", findings: [{ id: "F1", verdict: "valid", fix: { sha: final } }] });
  return { recheckSession, write };
};

test("a recheck cannot be skipped once fixes are committed", () => {
  const { write } = afterFixes();
  write({ step: "recheck", verdict: "SKIPPED" });
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("recheck is SKIPPED with no review-code session on the fix range");
});

test("a recheck that fails does not finish the run", () => {
  const { recheckSession, write } = afterFixes();
  expect(recheckSession("FAIL").status).toBe(0);
  write({ step: "recheck", verdict: "FAIL" });
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("recheck is FAIL, so the fixes still fail");
});

test("a recheck has to match its session", () => {
  const { recheckSession, write } = afterFixes();
  expect(recheckSession("FAIL").status).toBe(0);
  write({ step: "recheck", verdict: "PASS" });
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("recheck says PASS, and its session reported FAIL");
});

test("a finished review ends the run: next prints complete, and a fresh run resumes there from the handoff", () => {
  const { result, reviewStep } = atReview();
  expect(reviewStep("review-code", "code-review", "PASS").status).toBe(0);
  expect(reviewStep("validate-type-safety", "type-safety", "PASS").status).toBe(0);
  result(LIGHT_PASS, { depth: "light" });
  expect(stage(["done", "review"]).status).toBe(0);
  expect(stage(["next"]).stdout.trim()).toBe("complete");
  const handoff = join(artifacts, "handoff.md");
  expect(readFileSync(handoff, "utf8")).toContain("next_stage: complete");
  const fresh = join(root, "fresh-artifacts"); mkdirSync(fresh);
  expect(stage(["next", "--resume", "--handoff", handoff], { CATALYST_ARTIFACT_DIR: fresh }).stdout.trim()).toBe("complete");
});

// The validation report's verifier.
const VERIFY_VALIDATION = resolve(import.meta.dir, "../skills/ticket-oneshot/scripts/verify-validation");
const verifyReport = (text) => {
  const path = join(artifacts, "report.md");
  writeFileSync(path, text);
  return spawnSync("node", [VERIFY_VALIDATION, path], { cwd: repo, encoding: "utf8", env: { ...process.env, CATALYST_TICKET: "CTC-1", CATALYST_ARTIFACT_DIR: artifacts, CATALYST_REPOSITORY: "demo" } });
};
const goodReport = () => { atValidate(); return readFileSync(join(artifacts, "validation.md"), "utf8"); };
const CODE_SKIPPED = '"step":"code-review","verdict":"SKIPPED"';

test("a complete validation report passes its verifier", () => {
  expect(verifyReport(goodReport()).status).toBe(0);
});

test.each([
  ["code-review UNAVAILABLE", (d) => d.replace(CODE_SKIPPED, '"step":"code-review","verdict":"UNAVAILABLE"'), "code-review is UNAVAILABLE"],
  ["code-review FAIL", (d) => d.replace(CODE_SKIPPED, '"step":"code-review","verdict":"FAIL"'), "code-review is FAIL"],
  ["plan-conformance SKIPPED", (d) => d.replace('"step":"plan-conformance","verdict":"PASS"', '"step":"plan-conformance","verdict":"SKIPPED"'), "plan-conformance is SKIPPED"],
  ["a second ladder", (d) => `${d}\n${/```catalyst-validation-ladder[\s\S]*?```/.exec(d)[0]}\n`, "expected one catalyst-validation-ladder block, found 2"],
  ["a step named twice", (d) => d.replace('"step":"security-audit"', '"step":"code-review"'), "the ladder must name code-review exactly once"],
  ["no Requirements section", (d) => d.replace("## Requirements", "## Other"), "missing required section"],
  ["no ticket", (d) => d.replace("source_ticket: CTC-1\n", ""), "source_ticket must be CTC-1"],
  ["a broken reference", (d) => d.replace("`run.sh:1`", "`gone.sh:1`"), "unresolved file:line reference: gone.sh:1"],
  ["no reference", (d) => d.replace("`run.sh:1`", "run.sh:1"), "missing file:line reference"],
])("a validation report is refused with %s", (_name, change, message) => {
  const refused = verifyReport(change(goodReport()));
  expect(refused.status).not.toBe(0);
  expect(refused.stderr).toContain(message);
});

test("a report filled in from validate-plan's own template passes its verifier", () => {
  const text = readFileSync(resolve(import.meta.dir, "../skills/validate-plan/SKILL.md"), "utf8");
  const report = /```markdown\n(---\n[\s\S]*?# Validation Report:[\s\S]*?)\n```/.exec(text)?.[1];
  const ladder = /```catalyst-validation-ladder\n[\s\S]*?\n```/.exec(text)?.[0];
  expect(report).toBeTruthy();
  expect(ladder).toBeTruthy();
  const filled = report.replace("{TICKET}", "CTC-1").replace("{repo name}", "demo");
  const passing = ladder.replace('"step":"code-review","verdict":"FAIL"', '"step":"code-review","verdict":"SKIPPED"');
  expect(verifyReport(`${filled}\n\nEvidence: \`run.sh:1\`\n\n${passing}\n`).status).toBe(0);
  expect(text).toContain("`file:line` in backticks");
});

test("depth counts as deep when the depth script cannot answer", () => {
  const head = git("rev-parse", "HEAD");
  expect(reviewDepth(repo, "0".repeat(40), head)).toBe("deep");
  writeFileSync(join(repo, "b.txt"), "x\n"); commit("light");
  expect(reviewDepth(repo, head, git("rev-parse", "HEAD"))).toBe("light");
});
