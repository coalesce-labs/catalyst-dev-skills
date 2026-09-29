// consolidation.test.mjs — the owner's approved skill consolidations hold.
//
// Run: bun test tests/consolidation.test.mjs
//
// ask-triage (an alias nothing called) is retired; the unsticker skill keeps its `ask-triage/v1`
// record. iterate-plan's procedure lives in create-plan as its revise mode, and iterate-plan stays
// only as a thin alias so its trigger phrases still route.

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(repoRoot, p), "utf8");
const dirs = () => JSON.parse(read("packs/skills-ownership.json")).skills.map((s) => s.dir);
const front = (p) => Bun.YAML.parse(read(p).match(/^---\n([\s\S]*?)\n---/)[1]);

describe("ask-triage is retired", () => {
  test("its directory and ownership entry are gone", () => {
    expect(existsSync(join(repoRoot, "skills", "ask-triage"))).toBe(false);
    expect(dirs()).not.toContain("ask-triage");
  });

  test("the unsticker skill still writes the ask-triage/v1 record", () => {
    expect(read("skills/unsticker/SKILL.md")).toContain("ask-triage/v1");
  });
});

describe("create-plan revises plans; iterate-plan is its alias", () => {
  const create = read("skills/create-plan/SKILL.md");
  const revise = create.split("## Revising an existing plan")[1] ?? "";

  test("create-plan has a revise mode carrying the revision procedure", () => {
    expect(revise.length).toBeGreaterThan(0);
    for (const rule of [/Iteration History/, /completed phases/i, /thoughts\/shared\/plans/, /research/i]) expect(revise).toMatch(rule);
  });

  test("create-plan's description routes revision requests", () => {
    const desc = String(front("skills/create-plan/SKILL.md").description);
    expect(desc).toMatch(/update the plan/);
    expect(desc).toMatch(/revise|change the plan/);
  });

  test("iterate-plan is a thin alias that hands off to create-plan's revise mode", () => {
    const alias = read("skills/iterate-plan/SKILL.md");
    expect(alias.split("\n").length).toBeLessThanOrEqual(25);
    expect(alias).toMatch(/`create-plan`/);
    expect(alias).toMatch(/Revising an existing plan/);
    expect(existsSync(join(repoRoot, "skills", "iterate-plan", "assets"))).toBe(false);
  });

  test("iterate-plan keeps its trigger phrases so existing callers still route", () => {
    const desc = String(front("skills/iterate-plan/SKILL.md").description);
    for (const phrase of ["update the plan", "change the plan", "revise the approach"]) expect(desc).toContain(phrase);
  });
});

describe("unsticker is invoked by name only", () => {
  // Catalyst Cloud's fleet triage job names this skill in its prompt, so it stays in this pack.
  // A customer's "unstick" belongs to the Cloud pack's unstick skill, so the agent never picks
  // unsticker on its own.
  test("the skill the fleet's triage job names exists in this pack", () => {
    expect(existsSync(join(repoRoot, "skills", "unsticker", "SKILL.md"))).toBe(true);
    expect(dirs()).toContain("unsticker");
  });

  test("it is not auto-invoked, and its description says why", () => {
    const f = front("skills/unsticker/SKILL.md");
    expect(f["disable-model-invocation"]).toBe(true);
    expect(String(f.description)).toMatch(/by name/);
    expect(String(f.description)).toMatch(/Cloud pack's `?unstick`?/);
  });
});
