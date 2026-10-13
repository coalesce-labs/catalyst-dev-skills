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
function doc(kind, ticket = "CTC-1234", ref = "src/logic.ts:1") {
  const sections = {
    research: "## Research Question\nWhy?\n\n## Summary\nAnswer.\n\n## Detailed Findings\nFound `" + ref + "`.\n",
    plan: "## Overview\nGoal.\n\n## Implementation Steps\nChange `" + ref + "`.\n\n## Verification\nRun tests.\n\n## Files in scope\n- src/logic.ts\n",
    validation: "## Summary\nPass.\n\n## Plan Conformance\nGood.\n\n## Type Safety\nGood.\n\n## Review\nGood.\n\n## Security\nGood.\n\n## Gate\n`" + ref + "` resolves.\n",
  };
  return `---\nsource_ticket: ${ticket}\nrepository: catalyst-cloud\ntype: ${kind}\n---\n\n# ${kind}\n\n${sections[kind]}`;
}
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
