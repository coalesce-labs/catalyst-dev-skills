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
function run(name, args, f) {
  return spawnSync("node", [join(skill, "scripts", name), ...args], {
    cwd: f.root,
    env: { ...process.env, CATALYST_TICKET: "CTC-1234", CATALYST_ARTIFACT_DIR: f.artifacts, CATALYST_REPOSITORY: "catalyst-cloud" },
    encoding: "utf8",
  });
}
const ladder = '```catalyst-validation-ladder\n{"version":1,"steps":[{"step":"plan-conformance","verdict":"PASS"},{"step":"type-safety","verdict":"PASS"},{"step":"code-review","verdict":"PASS"},{"step":"security-review","verdict":"PASS"},{"step":"security-audit","verdict":"SKIPPED"}]}\n```\n';
function doc(kind, ticket = "CTC-1234", ref = "src/logic.ts:1") {
  const sections = {
    research: "## Research Question\nWhy?\n\n## Summary\nAnswer.\n\n## Detailed Findings\nFound `" + ref + "`.\n",
    plan: "## Overview\nGoal.\n\n## Implementation Steps\nChange `" + ref + "`.\n\n## Verification\nRun tests.\n\n## Files in scope\n- src/logic.ts\n",
    validation: "## Summary\nPass.\n\n## Plan Conformance\nGood.\n\n## Review\nGood.\n\n## Gate\n`" + ref + "` resolves.\n" + ladder,
  };
  return `---\nsource_ticket: ${ticket}\nrepository: catalyst-cloud\ntype: ${kind}\n---\n\n# ${kind}\n\n${sections[kind]}`;
}
test("verifiers accept the delegated create-plan and validate-plan report shapes", () => {
  const f = fixture();
  const plan = join(f.artifacts, "plan.md");
  writeFileSync(plan, `---\nsource_ticket: CTC-1234\nrepository: catalyst-cloud\n---\n\n# Implementation Plan\n\n## Overview\nTask.\n\n## Implementation Approach\nChange \`src/logic.ts:1\`.\n\n## Phase 1: Change\nDo it.\n\n## Testing Strategy (TDD)\nTest.\n\n## Files in scope\n- src/logic.ts\n`);
  expect(run("verify-plan", [plan], f).status).toBe(0);
  const validation = join(f.artifacts, "validation.md");
  writeFileSync(validation, `---\nsource_ticket: CTC-1234\nrepository: catalyst-cloud\n---\n\n# Validation Report\n\n## Validation Source\n\`src/logic.ts:1\`\n\n### Implementation Status\nComplete.\n\n### Automated Verification Results\nPassed.\n\n### Code Review Findings\nClear.\n\n${ladder}`);
  expect(run("verify-validation", [validation], f).status).toBe(0);
  writeFileSync(validation, readFileSync(validation, "utf8").replace('"security-review","verdict":"PASS"', '"security-review"'));
  expect(run("verify-validation", [validation], f).status).not.toBe(0);
});
test("verifiers accept adapted documents extracted from the real sub-skill templates", () => {
  const f = fixture();
  const planTemplate = readFileSync(resolve(skill, "../create-plan/references/plan-template.md"), "utf8");
  const planBody = /````markdown\n([\s\S]*?)\n````/.exec(planTemplate)?.[1];
  expect(planBody).toBeTruthy();
  const plan = join(f.artifacts, "plan.md");
  writeFileSync(plan, planBody.replace("repository: { REPO_NAME }", "repository: catalyst-cloud").replace("source_ticket: { TICKET-ID or null }", "source_ticket: CTC-1234") + "\n\n## Files in scope\n\n- `src/logic.ts:1`\n");
  expect(run("verify-plan", [plan], f).status).toBe(0);
  const validateSkill = readFileSync(resolve(skill, "../validate-plan/SKILL.md"), "utf8");
  const report = /```markdown\n(# Validation Report:[\s\S]*?)\n```/.exec(validateSkill)?.[1];
  const realLadder = /```catalyst-validation-ladder\n([\s\S]*?)\n```/.exec(validateSkill)?.[0];
  expect(report).toBeTruthy();
  expect(realLadder).toBeTruthy();
  const validation = join(f.artifacts, "validation.md");
  writeFileSync(validation, `---\nsource_ticket: CTC-1234\nrepository: catalyst-cloud\n---\n\n${report}\n\nEvidence: \`src/logic.ts:1\`\n\n${realLadder}\n`);
  expect(run("verify-validation", [validation], f).status).not.toBe(0);
  writeFileSync(validation, readFileSync(validation, "utf8").replace('"step":"code-review","verdict":"FAIL"', '"step":"code-review","verdict":"PASS"'));
  expect(run("verify-validation", [validation], f).status).toBe(0);
});
for (const kind of ["research", "plan", "validation"]) {
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
  expect(run("stage", ["done", "research"], f).status).toBe(0);
  expect(JSON.parse(readFileSync(join(f.artifacts, "stages", "2-research.done.json"), "utf8")).attempt).toBe(2);
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
test("validate stage refuses a document that fails its verifier", () => {
  const f = fixture();
  for (const stage of ["research", "plan", "implement"]) {
    writeFileSync(join(f.artifacts, `${stage}.md`), stage === "implement" ? "gate passed\n" : doc(stage));
    expect(run("stage", ["start", stage], f).status).toBe(0);
    expect(run("stage", ["done", stage], f).status).toBe(0);
  }
  writeFileSync(join(f.artifacts, "validation.md"), "---\nsource_ticket: CTC-1234\nrepository: catalyst-cloud\n---\n\n# Empty validation\n");
  expect(run("stage", ["start", "validate"], f).status).toBe(0);
  const result = run("stage", ["done", "validate"], f);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("missing required section");
});
test("validation cannot complete with failed or unavailable ladder verdicts", () => {
  const f = fixture();
  const path = join(f.artifacts, "validation.md");
  writeFileSync(path, doc("validation").replace('"plan-conformance","verdict":"PASS"', '"plan-conformance","verdict":"FAIL"'));
  expect(run("verify-validation", [path], f).status).not.toBe(0);
  writeFileSync(path, doc("validation").replace('"code-review","verdict":"PASS"', '"code-review","verdict":"UNAVAILABLE"'));
  expect(run("verify-validation", [path], f).status).not.toBe(0);
  writeFileSync(path, doc("validation"));
  expect(run("verify-validation", [path], f).status).toBe(0);
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
  writeFileSync(join(first.artifacts, "research.md"), doc("research"));
  expect(run("stage", ["start", "research"], first).status).toBe(0);
  expect(run("stage", ["done", "research"], first).status).toBe(0);
  expect(run("stage", ["start", "plan"], first).status).toBe(0);
  expect(run("stage", ["fail", "plan", "--reason", "blocked", "--class", "scope"], first).status).toBe(0);
  expect(readFileSync(handoff, "utf8")).toContain("completed_stage: research");
  expect(readFileSync(handoff, "utf8")).toContain("Resume stage: plan");
  const next = fixture();
  expect(run("stage", ["next", "--resume", "--handoff", handoff], next).stdout.trim()).toBe("plan");
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
  writeFileSync(older, "---\nsource_ticket: CTC-1234\nupdated_at: 2026-10-12T10:00:00Z\n---\n# Old\n");
  writeFileSync(newer, "---\nsource_ticket: CTC-1234\nupdated_at: 2026-10-12T11:00:00Z\n---\n# New\n");
  expect(run("thoughts", ["latest", "CTC-1234", "handoff"], f).stdout.trim().endsWith("2026-10-12-CTC-1234-a-plan.md")).toBe(true);
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
process.on("exit", () => { for (const folder of folders) rmSync(folder, { recursive: true, force: true }); });
