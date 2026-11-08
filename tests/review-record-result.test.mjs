// review-record-result.test.mjs — a review's result comes from the review skill's last step, and a
// gate refuses one typed by hand.
//
// Run: bun test tests/review-record-result.test.mjs
import { test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildResult, sealPath, summarize } from "../skills/review-and-verify/scripts/record-result.mjs";
import { reviewSealPath } from "../skills/ticket-oneshot/scripts/lib.mjs";

const STAGE = resolve(import.meta.dir, "../skills/ticket-oneshot/scripts/stage");
const VERIFY = resolve(import.meta.dir, "../skills/ticket-oneshot/scripts/verify-review");
const RECORD = resolve(import.meta.dir, "../skills/review-and-verify/scripts/record-result.mjs");
let root, repo, artifacts;
const git = (...args) => { const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const env = (extra = {}) => {
  const clean = { ...process.env, CATALYST_TICKET: "CTC-1", CATALYST_ARTIFACT_DIR: artifacts, CATALYST_REPOSITORY: "demo", ...extra };
  delete clean.CATALYST_PHASE;
  delete clean.CATALYST_CHECK_COMMAND;
  return clean;
};
const stage = (args, extra) => spawnSync("node", [STAGE, ...args], { cwd: repo, encoding: "utf8", env: env(extra) });
const record = (draft, args = []) => {
  const path = join(root, "draft.json");
  writeFileSync(path, JSON.stringify(draft));
  return spawnSync("node", [RECORD, "--draft", path, ...args], { cwd: repo, encoding: "utf8", env: env() });
};
const marker = (name, stageName) => { mkdirSync(join(artifacts, "stages"), { recursive: true }); writeFileSync(join(artifacts, "stages", name), JSON.stringify({ stage: stageName, attempt: 1, at: new Date().toISOString(), ticket: "CTC-1" })); };
const commit = (message) => { git("add", "-A"); git("-c", "core.hooksPath=/dev/null", "commit", "-qm", message); };
const resultPath = () => join(artifacts, "review-result.json");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "review-record-"));
  repo = join(root, "repo"); artifacts = join(root, "artifacts"); mkdirSync(repo); mkdirSync(artifacts);
  spawnSync("git", ["init", "-q", "--bare", join(root, "origin.git")]);
  git("init", "-q", "-b", "main"); git("config", "user.email", "t@t.invalid"); git("config", "user.name", "t");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "demo", scripts: { check: "true" } }));
  commit("base");
  git("remote", "add", "origin", join(root, "origin.git")); git("push", "-q", "origin", "main"); git("fetch", "-q", "origin");
  git("checkout", "-qb", "CTC-1");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A ticket at its review stage, with `file` holding `text` as the change under review. */
const atReview = (file = "notes.txt", text = "x\n") => {
  for (const s of ["research", "plan"]) { marker(`1-${s}.start.json`, s); marker(`1-${s}.done.json`, s); }
  expect(stage(["start", "implement"]).status).toBe(0);
  writeFileSync(join(artifacts, "implement.md"), "# notes\n");
  writeFileSync(join(repo, file), text); commit("change");
  expect(stage(["check"]).status).toBe(0);
  expect(stage(["done", "implement"]).status).toBe(0);
  marker("1-validate.start.json", "validate"); marker("1-validate.done.json", "validate");
  stage(["start", "pr"]); writeFileSync(join(artifacts, "pr.md"), "T\n");
  marker("1-pr.done.json", "pr");
  expect(stage(["start", "review"]).status).toBe(0);
  const base = git("merge-base", "origin/main", "HEAD");
  const head = git("rev-parse", "HEAD");
  const draft = (overrides = {}) => ({ version: 1, reviewed_head: head, base, gates: [{ step: "plan-conformance", verdict: "SKIPPED", detail: "no plan" }], findings: [], ...overrides });
  return { base, head, draft };
};

test("the record step writes the result from the draft, naming the head and each step that ran and when", () => {
  const { base, head, draft } = atReview();
  mkdirSync(join(artifacts, "reviews"), { recursive: true });
  const at = "2026-01-01T10:00:00.000Z";
  writeFileSync(join(artifacts, "reviews", `review-code-${head}.json`), JSON.stringify({ skill: "review-code", step: "code-review", base, head, verdict: "PASS", detail: "d", at }));
  writeFileSync(join(artifacts, "reviews", `review-code-${"f".repeat(40)}.json`), JSON.stringify({ skill: "review-code", step: "code-review", base, head: "f".repeat(40), verdict: "FAIL", at }));
  const findings = [{ id: "F1", path: "notes.txt", line: 1, verdict: "invalid", reason: "fixture" }];
  const ran = record(draft({ findings, summary: { found: 9 } }));
  expect(ran.status).toBe(0);
  const result = JSON.parse(readFileSync(resultPath(), "utf8"));
  expect(result).toMatchObject({ version: 1, reviewed_head: head, final_head: head, base, findings });
  expect(result.steps).toEqual([{ skill: "review-code", step: "code-review", base, head, verdict: "PASS", at }]);
  expect(result.summary).toEqual({ found: 1, fixed: 0, invalid: 1, deferred: 0, needs_human: 0 });
  expect(result.recorded).toMatchObject({ by: "review-and-verify/scripts/record-result.mjs", head });
  expect(Date.parse(result.recorded.at)).not.toBeNaN();
  expect(existsSync(join(artifacts, "review-result.seal.json"))).toBe(true);
});

test("the record step keeps a final_head the draft names, and prints the result when it has nowhere to write", () => {
  const draft = { reviewed_head: "a".repeat(40), final_head: "b".repeat(40), base: "c".repeat(40), findings: [] };
  const result = buildResult(draft, { head: "d".repeat(40), reviewsDir: join(tmpdir(), "no-such-reviews-dir") });
  expect(result.final_head).toBe("b".repeat(40));
  expect(result.steps).toEqual([]);
  expect(() => buildResult([], { head: "d".repeat(40), reviewsDir: "x" })).toThrow("one JSON object");
  writeFileSync(join(root, "draft.json"), JSON.stringify(draft));
  const clean = env(); delete clean.CATALYST_ARTIFACT_DIR;
  const printed = spawnSync("node", [RECORD, "--draft", join(root, "draft.json")], { cwd: repo, encoding: "utf8", env: clean });
  expect(printed.status).toBe(0);
  expect(JSON.parse(printed.stdout).final_head).toBe("b".repeat(40));
});

test("the record step's summary counts each verdict the way the schema does", () => {
  const verdicts = ["valid", "invalid", "already-fixed", "deferred", "needs-human", "valid"];
  expect(summarize(verdicts.map((verdict) => ({ verdict })))).toEqual({ found: 6, fixed: 2, invalid: 2, deferred: 1, needs_human: 1 });
});

test("both skills name the same seal beside the result", () => {
  expect(sealPath("/a/review-result.json")).toBe("/a/review-result.seal.json");
  expect(reviewSealPath("/a/review-result.json")).toBe(sealPath("/a/review-result.json"));
});

test("a hand-written result is refused, and the same result recorded through the skill is accepted", () => {
  const { head, draft } = atReview();
  writeFileSync(resultPath(), JSON.stringify({ ...draft(), final_head: head, summary: summarize([]) }));
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("was not written by the review skill's record step");
  expect(refused.stderr).toContain("record-result.mjs --draft");
  expect(existsSync(join(artifacts, "stages/1-review.done.json"))).toBe(false);
  expect(record(draft()).status).toBe(0);
  expect(stage(["done", "review"]).status).toBe(0);
  expect(existsSync(join(artifacts, "stages/1-review.done.json"))).toBe(true);
});

test("a result edited after it was recorded, with one finding removed, is refused on the seal", () => {
  const { draft } = atReview();
  const findings = [1, 2].map((line) => ({ id: `F${line}`, path: "notes.txt", line, verdict: "invalid", reason: "fixture" }));
  expect(record(draft({ findings })).status).toBe(0);
  const result = JSON.parse(readFileSync(resultPath(), "utf8"));
  writeFileSync(resultPath(), JSON.stringify({ ...result, findings: findings.slice(0, 1) }, null, 2) + "\n");
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("changed after the review skill recorded it");
  expect(existsSync(join(artifacts, "stages/1-review.done.json"))).toBe(false);
});

test("the exact bytes the old hand-writing test helper wrote are refused by both gates, and the same draft recorded passes", () => {
  const { base, head } = atReview();
  const gates = [{ step: "plan-conformance", verdict: "SKIPPED", detail: "no plan" }];
  const typed = { version: 1, reviewed_head: head, final_head: head, base, gates, findings: [] };
  writeFileSync(resultPath(), JSON.stringify(typed));
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("was not written by the review skill's record step");
  expect(refused.stderr).toContain("Record the result through the review skill's last step");
  const verified = spawnSync("node", [VERIFY, resultPath()], { cwd: repo, encoding: "utf8", env: env() });
  expect(verified.status).toBe(1);
  expect(verified.stderr).toContain("Record the result through the review skill's last step");
  expect(record(typed).status).toBe(0);
  expect(stage(["done", "review"]).status).toBe(0);
  expect(existsSync(join(artifacts, "stages/1-review.done.json"))).toBe(true);
});

test("a seal copied from another head is refused", () => {
  const { draft } = atReview();
  expect(record(draft()).status).toBe(0);
  const seal = JSON.parse(readFileSync(join(artifacts, "review-result.seal.json"), "utf8"));
  writeFileSync(join(artifacts, "review-result.seal.json"), JSON.stringify({ ...seal, final_head: "e".repeat(40) }));
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain(`seal names head ${"e".repeat(40)}`);
});

test("verify-review refuses a hand-written result and accepts a recorded one", () => {
  const { head, draft } = atReview();
  writeFileSync(resultPath(), JSON.stringify({ ...draft(), final_head: head }));
  const refused = spawnSync("node", [VERIFY, resultPath()], { cwd: repo, encoding: "utf8", env: env() });
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("was not written by the review skill's record step");
  expect(record(draft()).status).toBe(0);
  const accepted = spawnSync("node", [VERIFY, resultPath()], { cwd: repo, encoding: "utf8", env: env() });
  expect(accepted.status).toBe(0);
  expect(JSON.parse(accepted.stdout)).toMatchObject({ stage: "review", ok: true });
});

test("a recorded PASS with no findings is still refused until each scan hit is recorded as a finding", () => {
  const { base, head, draft } = atReview("a.js", "const x = y; // eslint-disable-line\n");
  // A fake session stands in for the harness: it reads the prompt and ends with its verdict.
  const session = `cat >/dev/null; printf 'report\\n\`\`\`catalyst-review-step\\n{"step":"code-review","verdict":"PASS","detail":"d"}\\n\`\`\`\\n'`;
  expect(stage(["review-step", "review-code", "--base", base], { CATALYST_REVIEW_SESSION_CMD: session }).status).toBe(0);
  const gates = [{ step: "code-review", verdict: "PASS" }];
  expect(record(draft({ gates })).status).toBe(0);
  expect(JSON.parse(readFileSync(resultPath(), "utf8")).steps).toMatchObject([{ skill: "review-code", step: "code-review", head, verdict: "PASS" }]);
  const refused = stage(["done", "review"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("a.js:1 lint suppression");
  expect(record(draft({ gates, findings: [{ id: "F1", path: "a.js", line: 1, verdict: "invalid", reason: "fixture" }] })).status).toBe(0);
  expect(stage(["done", "review"]).status).toBe(0);
});
