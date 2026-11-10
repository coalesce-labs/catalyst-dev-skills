import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const skill = resolve(import.meta.dir, "../skills/ticket-oneshot");
const folders = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ticket-oneshot-"));
  folders.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "logic.ts"), "export const answer = 42;\n");
  const artifacts = join(root, "artifacts");
  mkdirSync(artifacts);
  return { root, artifacts };
}
function run(name, args, f, extraEnv = {}) {
  return spawnSync("node", [join(skill, "scripts", name), ...args], {
    cwd: f.root,
    env: { ...process.env, CATALYST_TICKET: "CTC-1234", CATALYST_ARTIFACT_DIR: f.artifacts, CATALYST_REPOSITORY: "catalyst-cloud", ...extraEnv },
    encoding: "utf8",
  });
}
// With CATALYST_PHASE set the runner owns the implement gate; without it, stage done implement demands a green check record.
const RUNNER = { CATALYST_PHASE: "implement" };
function doc(kind, ticket = "CTC-1234", ref = "src/logic.ts:1") {
  const sections = {
    research: "## Research Question\nWhy?\n\n## Summary\nAnswer.\n\n## Detailed Findings\nFound `" + ref + "`.\n",
    validation: "## Requirements\n| AC1 | met | `" + ref + "` |\n\n```catalyst-validation-ladder\n" + JSON.stringify({ version: 1, steps: ["plan-conformance", "type-safety", "code-review", "security-review", "security-audit"].map((step, i) => ({ step, verdict: i === 0 ? "PASS" : "SKIPPED", detail: "d" })) }) + "\n```\n",
    plan: "## Overview\nGoal.\n\n## Acceptance criteria\n- **AC1** It works. Proof: `" + ref + "` test.\n\n## Phase 1: Change\nChange `" + ref + "`.\n\n## Verification\nRun tests.\n\n## Files in scope\n- src/logic.ts\n",
  };
  return `---\nsource_ticket: ${ticket}\nrepository: catalyst-cloud\ntype: ${kind}\n---\n\n# ${kind}\n\n${sections[kind]}`;
}
test("verifiers accept the delegated create-plan report shape", () => {
  const f = fixture();
  const plan = join(f.artifacts, "plan.md");
  writeFileSync(plan, `---\nsource_ticket: CTC-1234\nrepository: catalyst-cloud\n---\n\n# Implementation Plan\n\n## Overview\nTask.\n\n## Acceptance criteria\n\n- **AC1** It works. Proof: \`src/logic.ts:1\` test.\n\n## Phase 1: Change\nDo it.\n\n## Files in scope\n- src/logic.ts\n`);
  expect(run("verify-plan", [plan], f).status).toBe(0);
});
test("verifiers accept adapted documents extracted from the real sub-skill templates", () => {
  const f = fixture();
  const planTemplate = readFileSync(resolve(skill, "../create-plan/references/plan-template.md"), "utf8");
  const planBody = /````markdown\n([\s\S]*?)\n````/.exec(planTemplate)?.[1];
  expect(planBody).toBeTruthy();
  const plan = join(f.artifacts, "plan.md");
  writeFileSync(plan, planBody.replace("repository: <repo name>", "repository: catalyst-cloud").replace("source_ticket: <TICKET-ID or null>", "source_ticket: CTC-1234").replace("- `path/to/file`", "- `src/logic.ts:1`"));
  expect(run("verify-plan", [plan], f).status).toBe(0);
});
for (const kind of ["research", "plan"]) {
  test(`${kind} verifier accepts a complete doc and rejects missing ticket and broken reference`, () => {
    const f = fixture();
    const path = join(f.artifacts, `${kind}.md`);
    writeFileSync(path, doc(kind));
    expect(run(`verify-${kind}`, [path], f).status).toBe(0);
    writeFileSync(path, doc(kind).replace("source_ticket: CTC-1234\n", ""));
    const wrongTicket = run(`verify-${kind}`, [path], f);
    expect(wrongTicket.status).not.toBe(0);
    expect(wrongTicket.stderr).toContain("source_ticket");
    writeFileSync(path, doc(kind, "CTC-1234", "src/missing.ts:8"));
    const badRef = run(`verify-${kind}`, [path], f);
    expect(badRef.status).not.toBe(0);
    expect(badRef.stderr).toContain("src/missing.ts:8");
    writeFileSync(path, doc(kind, "CTC-1234", "src/logic.ts:2"));
    const outsideLine = run(`verify-${kind}`, [path], f);
    expect(outsideLine.status).not.toBe(0);
    expect(outsideLine.stderr).toContain("line outside file: src/logic.ts:2");
  });
}
test("document verifiers reject zero and out-of-bounds reference ranges", () => {
  const f = fixture();
  const path = join(f.artifacts, "research.md");
  for (const ref of ["src/logic.ts:0", "src/logic.ts:1-999", "src/logic.ts:2-1"]) {
    writeFileSync(path, doc("research", "CTC-1234", ref));
    expect(run("verify-research", [path], f).status).not.toBe(0);
  }
  writeFileSync(path, doc("research", "CTC-1234", "src/logic.ts:1-1"));
  expect(run("verify-research", [path], f).status).toBe(0);
  writeFileSync(join(f.root, "Dockerfile"), "FROM scratch\n");
  writeFileSync(path, doc("research", "CTC-1234", "Dockerfile:1"));
  expect(run("verify-research", [path], f).status).toBe(0);
  mkdirSync(join(f.root, "app", "[id]"), { recursive: true });
  writeFileSync(join(f.root, "app", "[id]", "page.tsx"), "export default function Page() {}\n");
  writeFileSync(path, doc("research", "CTC-1234", "app/[id]/page.tsx:1"));
  expect(run("verify-research", [path], f).status).toBe(0);
  writeFileSync(path, doc("research", "CTC-1234", "app/[missing]/page.tsx:1"));
  const missingRoute = run("verify-research", [path], f);
  expect(missingRoute.status).not.toBe(0);
  expect(missingRoute.stderr).toContain("app/[missing]/page.tsx:1");
});
test("stage markers enforce order, preserve completed docs and resume from handoff", () => {
  const f = fixture();
  writeFileSync(join(f.artifacts, "research.md"), doc("research"));
  expect(run("stage", ["start", "plan"], f).status).not.toBe(0);
  expect(run("stage", ["start", "research"], f).status).toBe(0);
  expect(run("stage", ["done", "research"], f).status).toBe(0);
  const marker = join(f.artifacts, "stages", "1-research.done.json");
  expect(existsSync(marker)).toBe(true);
  expect(JSON.parse(readFileSync(marker, "utf8")).event).toBe("phase.research.complete");
  const before = statSync(join(f.artifacts, "research.md")).mtimeMs;
  expect(run("stage", ["start", "research"], f).status).not.toBe(0);
  expect(run("stage", ["next", "--resume"], f).stdout.trim()).toBe("plan");
  expect(statSync(join(f.artifacts, "research.md")).mtimeMs).toBe(before);
  expect(readFileSync(join(f.artifacts, "handoff.md"), "utf8")).toContain("completed_stage: research");
  expect(run("stage", ["start", "plan"], f).status).toBe(0);
  const planStart = JSON.parse(readFileSync(join(f.artifacts, "stages", "1-plan.start.json"), "utf8"));
  expect(planStart.attempt).toBe(1);
});
test("failed stage retry uses the next attempt number without replacing prior markers", () => {
  const f = fixture();
  expect(run("stage", ["start", "research"], f).status).toBe(0);
  expect(run("stage", ["start", "research"], f).status).not.toBe(0);
  expect(run("stage", ["fail", "research", "--reason", "transient gate", "--class", "environment"], f).status).toBe(0);
  writeFileSync(join(f.artifacts, "research.md"), doc("research"));
  expect(run("stage", ["done", "research"], f).status).not.toBe(0);
  const firstStart = readFileSync(join(f.artifacts, "stages", "1-research.start.json"), "utf8");
  expect(run("stage", ["start", "research"], f).status).toBe(0);
  expect(JSON.parse(readFileSync(join(f.artifacts, "stages", "2-research.start.json"), "utf8")).attempt).toBe(2);
  expect(readFileSync(join(f.artifacts, "stages", "1-research.start.json"), "utf8")).toBe(firstStart);
  const stale = run("stage", ["done", "research"], f);
  expect(stale.status).not.toBe(0);
  expect(stale.stderr).toContain("fresh artifact evidence");
  writeFileSync(join(f.artifacts, "research.md"), doc("research"));
  expect(run("stage", ["done", "research"], f).status).toBe(0);
  expect(JSON.parse(readFileSync(join(f.artifacts, "stages", "2-research.done.json"), "utf8")).attempt).toBe(2);
});
test("a hostile stage name is refused before anything uses it", () => {
  const f = fixture();
  const payload = "(a+)+$";
  const refused = run("stage", ["start", payload], f);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain(`unknown stage: ${payload}`);
  expect(existsSync(join(f.artifacts, "stages"))).toBe(false);
});
test("only a stage's own numbered fail markers use up its attempts", () => {
  const f = fixture();
  const stages = join(f.artifacts, "stages");
  mkdirSync(stages, { recursive: true });
  for (const name of ["x-research.fail.json", "01-research.fail.json", "1-other-research.fail.json", "1-research.fail.json.bak", "9-research.skip.json"]) writeFileSync(join(stages, name), "not json");
  for (const attempt of [1, 2]) {
    expect(run("stage", ["start", "research"], f).status).toBe(0);
    expect(run("stage", ["fail", "research", "--reason", `attempt ${attempt}`, "--class", "code"], f).status).toBe(0);
  }
  const third = run("stage", ["start", "research"], f);
  expect(third.status).not.toBe(0);
  expect(third.stderr).toContain("already used its 2 attempts");
});
test("a runner owns retries: a third start under a phase runner is allowed, and with no runner it still stops", () => {
  const runner = fixture();
  for (const attempt of [1, 2, 3, 4]) {
    expect(run("stage", ["start", "research"], runner, RUNNER).status).toBe(0);
    expect(run("stage", ["fail", "research", "--reason", `attempt ${attempt}`, "--class", "code"], runner, RUNNER).status).toBe(0);
  }
  const fifth = run("stage", ["start", "research"], runner, RUNNER);
  expect(fifth.status).toBe(0);
  expect(JSON.parse(readFileSync(join(runner.artifacts, "stages", "5-research.start.json"), "utf8")).attempt).toBe(5);
  const alone = fixture();
  const env = { CATALYST_PHASE: "" };
  for (const attempt of [1, 2]) {
    expect(run("stage", ["start", "research"], alone, env).status).toBe(0);
    expect(run("stage", ["fail", "research", "--reason", `attempt ${attempt}`, "--class", "code"], alone, env).status).toBe(0);
  }
  const third = run("stage", ["start", "research"], alone, env);
  expect(third.status).not.toBe(0);
  expect(third.stderr).toContain("already used its 2 attempts; stop and leave the handoff for a person");
});
test("with no runner, environment failures do not use up an attempt, and a fifth start after four is refused", () => {
  const f = fixture();
  const env = { CATALYST_PHASE: "" };
  for (const attempt of [1, 2, 3, 4]) {
    expect(run("stage", ["start", "research"], f, env).status).toBe(0);
    expect(run("stage", ["fail", "research", "--reason", `host lost ${attempt}`, "--class", "environment"], f, env).status).toBe(0);
  }
  const fifth = run("stage", ["start", "research"], f, env);
  expect(fifth.status).not.toBe(0);
  expect(fifth.stderr).toContain("reached 4 attempts counting environment failures; stop and leave the handoff for a person");
  expect(existsSync(join(f.artifacts, "stages", "5-research.start.json"))).toBe(false);
});
test("resuming an open attempt preserves its start marker", () => {
  const f = fixture();
  expect(run("stage", ["start", "research"], f).status).toBe(0);
  const marker = join(f.artifacts, "stages", "1-research.start.json");
  const before = readFileSync(marker, "utf8");
  expect(run("stage", ["wait", "answer", "--key", "CTC-9999", "--deadline", "2026-10-13T06:00:00Z"], f).status).toBe(0);
  expect(run("stage", ["next", "--resume"], f).stdout.trim()).toBe("research");
  expect(run("stage", ["start", "research", "--resume"], f).status).toBe(0);
  expect(readFileSync(marker, "utf8")).toBe(before);
  writeFileSync(join(f.artifacts, "research.md"), doc("research"));
  expect(run("stage", ["done", "research"], f).status).toBe(0);
});
test("wait deadline is normalized to the CTC-5742 UTC wire format", () => {
  const f = fixture();
  expect(run("stage", ["wait", "review", "--key", "pr:94", "--deadline", "2026-10-13T01:00:00-05:00", "--resume-from", "research"], f).status).toBe(0);
  const wait = JSON.parse(readFileSync(join(f.artifacts, "wait.json"), "utf8"));
  expect(wait.deadline).toBe("2026-10-13T06:00:00.000Z");
  expect(wait.resume_from).toBe("research");
  expect(readFileSync(join(f.artifacts, "handoff.md"), "utf8")).toContain('repository: "catalyst-cloud"');
  const fresh = fixture();
  expect(run("stage", ["wait", "review", "--key", "pr:94", "--deadline", "2026-10-13T06:00:00Z", "--resume-from", "pr"], fresh).status).not.toBe(0);
  expect(existsSync(join(fresh.artifacts, "handoff.md"))).toBe(false);
});
test("a scoped package name is a valid handoff repository and is checked before completion", () => {
  const f = fixture();
  const env = { ...process.env, CATALYST_TICKET: "CTC-1234", CATALYST_ARTIFACT_DIR: f.artifacts };
  delete env.CATALYST_REPOSITORY;
  const stage = (...args) => spawnSync("node", [join(skill, "scripts", "stage"), ...args], { cwd: f.root, env, encoding: "utf8" });
  writeFileSync(join(f.artifacts, "research.md"), doc("research"));
  expect(stage("start", "research").status).toBe(0);
  expect(stage("done", "research").status).not.toBe(0);
  expect(existsSync(join(f.artifacts, "stages", "1-research.done.json"))).toBe(false);
  writeFileSync(join(f.root, "package.json"), '{"name":"@example/service"}\n');
  expect(stage("done", "research").status).toBe(0);
  expect(readFileSync(join(f.artifacts, "handoff.md"), "utf8")).toContain('repository: "@example/service"');
});
test("stage done refuses a missing or invalid artifact", () => {
  const f = fixture();
  expect(run("stage", ["start", "research"], f).status).toBe(0);
  expect(run("stage", ["done", "research"], f).status).not.toBe(0);
  writeFileSync(join(f.artifacts, "research.md"), doc("research", "CTC-9999"));
  expect(run("stage", ["done", "research"], f).status).not.toBe(0);
  expect(existsSync(join(f.artifacts, "stages", "1-research.done.json"))).toBe(false);
});
function reachImplement(f) {
  for (const stage of ["research", "plan"]) {
    writeFileSync(join(f.artifacts, `${stage}.md`), doc(stage));
    expect(run("stage", ["start", stage], f).status).toBe(0);
    expect(run("stage", ["done", stage], f).status).toBe(0);
  }
}
test("stage done implement succeeds before the runner writes implement.md", () => {
  const f = fixture();
  reachImplement(f);
  expect(run("stage", ["start", "implement"], f).status).toBe(0);
  expect(existsSync(join(f.artifacts, "implement.md"))).toBe(false);
  expect(run("stage", ["done", "implement"], f, RUNNER).status).toBe(0);
  const marker = JSON.parse(readFileSync(join(f.artifacts, "stages", "1-implement.done.json"), "utf8"));
  expect(marker.artifact).toBe("implement.md");
  expect(readFileSync(join(f.artifacts, "handoff.md"), "utf8")).toContain("completed_stage: implement");
});
test("stage done implement on a second attempt skips the fresh evidence check", () => {
  const f = fixture();
  reachImplement(f);
  expect(run("stage", ["start", "implement"], f).status).toBe(0);
  expect(run("stage", ["fail", "implement", "--reason", "gate failed", "--class", "code"], f).status).toBe(0);
  expect(run("stage", ["start", "implement"], f).status).toBe(0);
  expect(JSON.parse(readFileSync(join(f.artifacts, "stages", "2-implement.start.json"), "utf8")).attempt).toBe(2);
  const done = run("stage", ["done", "implement"], f, RUNNER);
  expect(done.status).toBe(0);
  expect(JSON.parse(readFileSync(join(f.artifacts, "stages", "2-implement.done.json"), "utf8")).artifact).toBe("implement.md");
});
test("stage done still refuses a missing artifact for a session-owned stage", () => {
  const f = fixture();
  writeFileSync(join(f.artifacts, "research.md"), doc("research"));
  expect(run("stage", ["start", "research"], f).status).toBe(0);
  expect(run("stage", ["done", "research"], f).status).toBe(0);
  expect(run("stage", ["start", "plan"], f).status).toBe(0);
  const result = run("stage", ["done", "plan"], f);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("missing stage artifact");
  expect(existsSync(join(f.artifacts, "stages", "1-plan.done.json"))).toBe(false);
});
test("the stage catalog marks only implement as runner-owned", () => {
  const catalog = JSON.parse(readFileSync(join(skill, "stages.json"), "utf8"));
  expect(catalog.stages.filter((item) => item.owner === "runner").map((item) => item.stage)).toEqual(["implement"]);
  expect(catalog.stages.filter((item) => "owner" in item).length).toBe(1);
});
const NO_RUNNER = { CATALYST_PHASE: "" };
function finishFive(f, prEnv = RUNNER) {
  for (const stage of ["research", "plan", "implement", "validate", "pr"]) {
    writeFileSync(join(f.artifacts, `${stage === "validate" ? "validation" : stage}.md`), stage === "validate" ? doc("validation") : ["research", "plan"].includes(stage) ? doc(stage) : `${stage} complete\n`);
    expect(run("stage", ["start", stage], f, RUNNER).status).toBe(0);
    const result = run("stage", ["done", stage], f, stage === "pr" ? prEnv : RUNNER);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }
}
test("a supervised run is told the workflow is complete after its pr stage", () => {
  const f = fixture();
  finishFive(f);
  expect(run("stage", ["next"], f, RUNNER).stdout.trim()).toBe("complete");
  expect(readFileSync(join(f.artifacts, "handoff.md"), "utf8")).toContain("completed_stage: pr\nnext_stage: complete");
});
test("with no runner the pr stage is still followed by review", () => {
  const f = fixture();
  finishFive(f, NO_RUNNER);
  expect(run("stage", ["next"], f, NO_RUNNER).stdout.trim()).toBe("review");
  expect(readFileSync(join(f.artifacts, "handoff.md"), "utf8")).toContain("completed_stage: pr\nnext_stage: review");
});
test("a supervised run cannot start the review stage", () => {
  const f = fixture();
  finishFive(f);
  const result = run("stage", ["start", "review"], f, RUNNER);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("runner");
  expect(existsSync(join(f.artifacts, "stages", "1-review.start.json"))).toBe(false);
});
test("a supervised wait after pr resumes at pr and cold-resumes to complete", () => {
  const first = fixture();
  finishFive(first);
  const waited = run("stage", ["wait", "ci", "--key", "pr:94", "--deadline", "2026-10-13T06:00:00Z"], first, RUNNER);
  expect(waited.stderr).toBe("");
  expect(waited.status).toBe(0);
  const handoff = join(first.artifacts, "handoff.md");
  const text = readFileSync(handoff, "utf8");
  expect(text).toContain("next_stage: complete");
  expect(text).toContain("resume_stage: pr");
  const fresh = fixture();
  expect(run("stage", ["next", "--resume", "--handoff", handoff], fresh, RUNNER).stdout.trim()).toBe("complete");
});
test("the stage catalog marks only review as absent under a runner", () => {
  const catalog = JSON.parse(readFileSync(join(skill, "stages.json"), "utf8"));
  expect(catalog.stages.filter((item) => item.runner === false).map((item) => item.stage)).toEqual(["review"]);
  expect(catalog.stages.filter((item) => "owner" in item).map((item) => item.stage)).toEqual(["implement"]);
});
test("SKILL.md says a supervised run ends at pr", () => {
  const text = readFileSync(join(skill, "SKILL.md"), "utf8");
  const sentences = text.split(/(?<=\.)\s+/);
  expect(sentences.some((line) => /supervised|phase runner/.test(line) && line.includes("CATALYST_PHASE") && /`pr`/.test(line) && /`complete`/.test(line))).toBe(true);
});
test("a failed stage and wait leave a cold-resumable handoff", () => {
  const first = fixture();
  expect(run("stage", ["start", "research"], first).status).toBe(0);
  expect(run("stage", ["fail", "research", "--reason", "needs answer", "--class", "question"], first).status).toBe(0);
  expect(run("stage", ["wait", "answer", "--key", "CTC-9999", "--deadline", "2026-10-13T06:00:00Z"], first).status).toBe(0);
  const handoff = join(first.artifacts, "handoff.md");
  expect(readFileSync(handoff, "utf8")).toContain("completed_stage: none");
  expect(readFileSync(handoff, "utf8")).toContain("Wait: answer CTC-9999");
  const fresh = fixture();
  expect(run("stage", ["next", "--resume", "--handoff", handoff], fresh).stdout.trim()).toBe("research");
  expect(JSON.parse(readFileSync(join(fresh.artifacts, "stages", "1-research.fail.json"), "utf8")).class).toBe("question");
  expect(run("stage", ["start", "research", "--resume"], fresh).status).toBe(0);
  expect(JSON.parse(readFileSync(join(fresh.artifacts, "stages", "2-research.start.json"), "utf8")).attempt).toBe(2);
  expect(run("stage", ["start", "research"], first).status).toBe(0);
  writeFileSync(join(first.artifacts, "research.md"), doc("research"));
  expect(run("stage", ["done", "research"], first).status).toBe(0);
  expect(run("stage", ["start", "plan"], first).status).toBe(0);
  expect(run("stage", ["fail", "plan", "--reason", "blocked", "--class", "scope"], first).status).toBe(0);
  expect(readFileSync(handoff, "utf8")).toContain("completed_stage: research");
  expect(readFileSync(handoff, "utf8")).toContain("Resume stage: plan");
  const next = fixture();
  expect(run("stage", ["next", "--resume", "--handoff", handoff], next).stdout.trim()).toBe("plan");
  expect(run("stage", ["start", "plan", "--resume"], next).status).toBe(0);
  expect(JSON.parse(readFileSync(join(next.artifacts, "stages", "2-plan.start.json"), "utf8")).attempt).toBe(2);
});
test("cold resume preserves an open attempt marker", () => {
  const first = fixture();
  expect(run("stage", ["start", "research"], first).status).toBe(0);
  expect(run("stage", ["wait", "review", "--key", "pr:94", "--deadline", "2026-10-13T06:00:00Z"], first).status).toBe(0);
  const fresh = fixture();
  expect(run("stage", ["next", "--resume", "--handoff", join(first.artifacts, "handoff.md")], fresh).stdout.trim()).toBe("research");
  expect(run("stage", ["start", "research", "--resume"], fresh).status).toBe(0);
  expect(readFileSync(join(fresh.artifacts, "stages", "1-research.start.json"), "utf8")).toBe(readFileSync(join(first.artifacts, "stages", "1-research.start.json"), "utf8"));
  expect(existsSync(join(fresh.artifacts, "stages", "2-research.start.json"))).toBe(false);
});
test("local resume refuses a handoff from another repository", () => {
  const f = fixture();
  expect(run("stage", ["start", "research"], f).status).toBe(0);
  expect(run("stage", ["wait", "answer", "--key", "CTC-9999", "--deadline", "2026-10-13T06:00:00Z"], f).status).toBe(0);
  const foreign = spawnSync("node", [join(skill, "scripts", "stage"), "next", "--resume"], {
    cwd: f.root,
    env: { ...process.env, CATALYST_TICKET: "CTC-1234", CATALYST_ARTIFACT_DIR: f.artifacts, CATALYST_REPOSITORY: "other-repo" },
    encoding: "utf8",
  });
  expect(foreign.status).not.toBe(0);
  expect(foreign.stderr).toContain("handoff repository does not match");
  expect(run("stage", ["next", "--resume"], f).stdout.trim()).toBe("research");
});
test("cold resume rejects another ticket's first-stage handoff before persisting it", () => {
  const first = fixture();
  expect(run("stage", ["start", "research"], first).status).toBe(0);
  expect(run("stage", ["fail", "research", "--reason", "question", "--class", "question"], first).status).toBe(0);
  const foreign = join(first.artifacts, "foreign-handoff.md");
  writeFileSync(foreign, readFileSync(join(first.artifacts, "handoff.md"), "utf8").replace("source_ticket: CTC-1234", "source_ticket: CTC-9999"));
  const fresh = fixture();
  const result = run("stage", ["next", "--resume", "--handoff", foreign], fresh);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("source_ticket must be CTC-1234");
  expect(existsSync(join(fresh.artifacts, "handoff.md"))).toBe(false);
});
test("cold resume rejects another repository's handoff for the same ticket", () => {
  const first = fixture();
  expect(run("stage", ["start", "research"], first).status).toBe(0);
  expect(run("stage", ["fail", "research", "--reason", "question", "--class", "question"], first).status).toBe(0);
  const foreign = join(first.artifacts, "foreign-repo-handoff.md");
  writeFileSync(foreign, readFileSync(join(first.artifacts, "handoff.md"), "utf8").replace("repository: \"catalyst-cloud\"", "repository: \"catalyst-other\""));
  const fresh = fixture();
  const result = run("stage", ["next", "--resume", "--handoff", foreign], fresh);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("handoff repository must be catalyst-cloud");
  expect(existsSync(join(fresh.artifacts, "handoff.md"))).toBe(false);
});
test("a PR wait handoff cold-resumes at review once the pr stage is done", () => {
  const first = fixture();
  for (const stage of ["research", "plan", "implement", "validate", "pr"]) {
    writeFileSync(join(first.artifacts, `${stage === "validate" ? "validation" : stage}.md`), stage === "validate" ? doc("validation") : ["research", "plan"].includes(stage) ? doc(stage) : `${stage} complete\n`);
    expect(run("stage", ["start", stage], first).status).toBe(0);
    expect(run("stage", ["done", stage], first, RUNNER).status).toBe(0);
  }
  expect(run("stage", ["wait", "review", "--key", "pr:94", "--deadline", "2026-10-13T06:00:00Z", "--resume-from", "review"], first).status).toBe(0);
  const handoff = join(first.artifacts, "handoff.md");
  expect(readFileSync(handoff, "utf8")).toContain("completed_stage: pr\nnext_stage: review");
  const fresh = fixture();
  expect(run("stage", ["next", "--resume", "--handoff", handoff], fresh).stdout.trim()).toBe("review");
});
test("resume rejects a stale handoff behind completed local markers", () => {
  const f = fixture();
  for (const stage of ["research", "plan"]) {
    writeFileSync(join(f.artifacts, `${stage}.md`), doc(stage));
    expect(run("stage", ["start", stage], f).status).toBe(0);
    expect(run("stage", ["done", stage], f).status).toBe(0);
    if (stage === "research") writeFileSync(join(f.artifacts, "stale.md"), readFileSync(join(f.artifacts, "handoff.md")));
  }
  writeFileSync(join(f.artifacts, "handoff.md"), readFileSync(join(f.artifacts, "stale.md")));
  const stale = run("stage", ["next", "--resume"], f);
  expect(stale.status).not.toBe(0);
  expect(stale.stderr).toContain("handoff progress does not match");
});
test("cold resume uses a published handoff and starts at implement without rewriting research or plan", () => {
  const first = fixture();
  for (const stage of ["research", "plan"]) {
    writeFileSync(join(first.artifacts, `${stage}.md`), doc(stage));
    expect(run("stage", ["start", stage], first).status).toBe(0);
    expect(run("stage", ["done", stage], first).status).toBe(0);
  }
  const research = join(first.artifacts, "research.md");
  const plan = join(first.artifacts, "plan.md");
  const before = [statSync(research).mtimeMs, statSync(plan).mtimeMs];
  const fresh = fixture();
  const handoff = join(first.artifacts, "handoff.md");
  expect(run("stage", ["next", "--resume", "--handoff", handoff], fresh).stdout.trim()).toBe("implement");
  expect(run("stage", ["start", "implement"], fresh).status).toBe(0);
  expect([statSync(research).mtimeMs, statSync(plan).mtimeMs]).toEqual(before);
  expect(existsSync(join(fresh.artifacts, "stages", "1-research.done.json"))).toBe(false);
});
test("thoughts put stores only in artifact dir and latest sees ticket doc", () => {
  const f = fixture();
  const thoughts = join(f.root, "thoughts", "shared", "research");
  mkdirSync(thoughts, { recursive: true });
  writeFileSync(join(thoughts, "2026-10-12-CTC-1234-example.md"), doc("research"));
  const latest = run("thoughts", ["latest", "CTC-1234", "research"], f);
  expect(latest.status).toBe(0);
  expect(latest.stdout).toContain("2026-10-12-CTC-1234-example.md");
  const put = run("thoughts", ["put", "research", join(thoughts, "2026-10-12-CTC-1234-example.md")], f);
  expect(put.status).toBe(0);
  expect(readFileSync(join(f.artifacts, "research.md"), "utf8")).toContain("source_ticket: CTC-1234");
});
test("latest chooses the newest same-day handoff timestamp, regardless of filename suffix", () => {
  const f = fixture();
  const folder = join(f.root, "thoughts", "shared", "handoffs");
  mkdirSync(folder, { recursive: true });
  const older = join(folder, "2026-10-12-CTC-1234-z-research.md");
  const newer = join(folder, "2026-10-12-CTC-1234-a-plan.md");
  writeFileSync(older, "---\nsource_ticket: CTC-1234\nrepository: catalyst-cloud\nupdated_at: 2026-10-12T10:00:00Z\ncompleted_stage: none\nnext_stage: research\n---\n# Old\n");
  writeFileSync(newer, "---\nsource_ticket: CTC-1234\nrepository: catalyst-cloud\nupdated_at: 2026-10-12T11:00:00Z\ncompleted_stage: none\nnext_stage: research\n---\n# New\n");
  expect(run("thoughts", ["latest", "CTC-1234", "handoff"], f).stdout.trim().endsWith("2026-10-12-CTC-1234-a-plan.md")).toBe(true);
  const foreign = join(folder, "2026-10-12-CTC-1234-other.md");
  writeFileSync(foreign, "---\nsource_ticket: CTC-1234\nrepository: catalyst-other\nupdated_at: 2026-10-12T12:00:00Z\ncompleted_stage: none\nnext_stage: research\n---\n# Other\n");
  const selected = run("thoughts", ["latest", "CTC-1234", "handoff"], f);
  expect(selected.stdout.trim().endsWith("2026-10-12-CTC-1234-a-plan.md")).toBe(true);
  expect(run("stage", ["next", "--resume", "--handoff", selected.stdout.trim()], f).stdout.trim()).toBe("research");
});
test("thoughts search limits repository scope in a shared pool", () => {
  const f = fixture();
  const thoughts = join(f.root, "thoughts", "shared", "research");
  mkdirSync(thoughts, { recursive: true });
  writeFileSync(join(thoughts, "2026-10-12-CTC-1234-cloud.md"), doc("research").replace("Answer.", "Needle."));
  writeFileSync(join(thoughts, "2026-10-12-CTL-1234-other.md"), doc("research").replace("repository: catalyst-cloud", "repository: catalyst").replace("Answer.", "Needle."));
  const repo = run("thoughts", ["search", "Needle", "--scope", "repo"], f);
  expect(repo.status).toBe(0);
  expect(repo.stdout).toContain("cloud.md");
  expect(repo.stdout).not.toContain("other.md");
  const team = run("thoughts", ["search", "Needle", "--scope", "team"], f);
  expect(team.stdout).toContain("other.md");
});
function runAs(ticket, name, args, f) {
  return spawnSync("node", [join(skill, "scripts", name), ...args], {
    cwd: f.root,
    env: { ...process.env, CATALYST_TICKET: ticket, CATALYST_ARTIFACT_DIR: f.artifacts, CATALYST_REPOSITORY: "catalyst-cloud" },
    encoding: "utf8",
  });
}
test("stage markers accept a ticket whose team key contains digits", () => {
  const f = fixture();
  writeFileSync(join(f.artifacts, "research.md"), doc("research", "ABC2-17"));
  expect(runAs("ABC2-17", "stage", ["start", "research"], f).status).toBe(0);
  expect(existsSync(join(f.artifacts, "stages", "1-research.start.json"))).toBe(true);
  expect(runAs("ABC2-17", "stage", ["done", "research"], f).status).toBe(0);
  expect(JSON.parse(readFileSync(join(f.artifacts, "stages", "1-research.done.json"), "utf8")).event).toBe("phase.research.complete");
});
test("thoughts latest finds the handoff of a ticket whose team key contains digits", () => {
  const f = fixture();
  const folder = join(f.root, "thoughts", "shared", "handoffs");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "2026-10-26-ABC2-17-handoff.md"), "---\nsource_ticket: ABC2-17\nrepository: catalyst-cloud\nupdated_at: 2026-10-26T20:00:00Z\ncompleted_stage: none\nnext_stage: research\n---\n# Handoff\n");
  const latest = runAs("ABC2-17", "thoughts", ["latest", "ABC2-17", "handoff"], f);
  expect(latest.status).toBe(0);
  expect(latest.stdout.trim().endsWith("2026-10-26-ABC2-17-handoff.md")).toBe(true);
});
for (const bad of ["abc2-17", "2ABC-17", "ABC2-", "ABC2_17", "ABC2-17x"]) {
  test(`stage and thoughts refuse ${JSON.stringify(bad)} as a ticket id`, () => {
    const f = fixture();
    const start = runAs(bad, "stage", ["start", "research"], f);
    expect(start.status).not.toBe(0);
    expect(start.stderr).toContain("CATALYST_TICKET must be a ticket id");
    expect(existsSync(join(f.artifacts, "stages", "1-research.start.json"))).toBe(false);
    const latest = runAs(bad, "thoughts", ["latest", bad, "handoff"], f);
    expect(latest.status).not.toBe(0);
    expect(latest.stderr).toContain("ticket id is required");
  });
}
process.on("exit", () => { for (const folder of folders) rmSync(folder, { recursive: true, force: true }); });
