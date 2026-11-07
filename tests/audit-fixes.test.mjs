// audit-fixes.test.mjs — defects the skill overlap audit found, held fixed.
//
// Run: bun test tests/audit-fixes.test.mjs

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(repoRoot, p), "utf8");
const skills = readdirSync(join(repoRoot, "skills"));

describe("retired skills are gone and unnamed", () => {
  test("the linear skill is retired: ticket work on a cloud account is the Cloud pack's catalyst-linear", () => {
    expect(existsSync(join(repoRoot, "skills", "linear"))).toBe(false);
    expect(JSON.parse(read("packs/skills-ownership.json")).skills.map((s) => s.dir)).not.toContain("linear");
  });
});

describe("each skill's instructions match what it runs", () => {
  test("implement-plan names the review that comes next and no harness-only reviewer", () => {
    const text = read("skills/implement-plan/SKILL.md");
    expect(text).not.toMatch(/pr-review-toolkit/);
    expect(text).toMatch(/Unless a runner or coordinator started you, say that no review has run and that the `review-and-verify` skill comes next/);
    expect(text).toMatch(/A plan path in the arguments needs no confirmation/);
  });

  test("implement-plan's person-facing limits stay in its text", () => {
    const text = read("skills/implement-plan/SKILL.md");
    expect(text).toMatch(/When unattended, or when the person asked for commits, commit now/);
    expect(text).toMatch(/If the branch has commits `origin\/main` lacks, merge `origin\/main` first/);
  });

  test("describe-pr stops when there is no pull request to describe", () => {
    expect(read("skills/describe-pr/SKILL.md")).toMatch(/With no pull request, stop and report `no_pr_found`/);
  });

  test("create-worktree's headless launch reviews what it opens", () => {
    expect(read("skills/create-worktree/SKILL.md")).toMatch(/create PR, run the review-and-verify skill on it/);
  });

  test("merge-pr describes the review skills by what they check", () => {
    const text = read("skills/merge-pr/references/verify-gates.md");
    expect(text).not.toMatch(/dependency \+ secret scan \| the `review-security`/);
    expect(text).not.toMatch(/style\/guideline adherence \| the `review-code`/);
  });

  test("research-codebase posts its completion comment through the app actor, never bare linearis", () => {
    expect(read("skills/research-codebase/SKILL.md")).not.toMatch(/Use Linearis CLI \(run `linearis comments usage`/);
  });

  test("every vendor.yaml names the generator that exists", () => {
    const stale = skills
      .filter((d) => existsSync(join(repoRoot, "skills", d, "agents", "vendor.yaml")))
      .filter((d) => /plugins\/dev|scripts\/packaging\/cli\.mjs|\b[A-Z]{2,4}-\d+\b/.test(read(`skills/${d}/agents/vendor.yaml`)));
    expect(stale).toEqual([]);
  });

  test("compound-estimate reads the starting estimate through the catalyst CLI when this machine is connected", () => {
    expect(read("skills/compound-estimate/SKILL.md")).toMatch(/catalyst query issue/);
  });
});
