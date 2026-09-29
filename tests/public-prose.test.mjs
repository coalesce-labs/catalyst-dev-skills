// public-prose.test.mjs — every skill reads as public, harness-agnostic documentation, and every
// SKILL.md frontmatter follows the Agent Skills specification.
//
// Run: bun test tests/public-prose.test.mjs
//
// scripts/check-public-prose.mjs owns the prose rules; this file holds the tree to them and proves
// each rule still matches what it is meant to catch.

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { RULES, check, findings } from "../scripts/check-public-prose.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("skill prose is public and harness-agnostic", () => {
  // Positive controls: one planted line per rule, each caught by exactly that rule.
  const planted = {
    "plugin-prefix": "Run `/catalyst-dev:create-plan` first.",
    "named-person": "Ask Ryan before merging.",
    "ticket-id": "This guard came from CTC-1234.",
    "adr-id": "See ADR-20260927T224315 for the layout.",
    "dated-history": "Decided on 2026-09-26, so the rail is gone.",
    "retired-cli": "Run `catalyst-skills query issue ENG-1`.",
    "private-reference": "Clone coalesce-labs/catalyst-cloud and ask Lantern.",
  };

  for (const rule of RULES) {
    test(`control: the ${rule.id} rule catches its planted line`, () => {
      expect(findings("planted.md", planted[rule.id]).map((f) => f.rule)).toContain(rule.id);
    });
  }

  test("control: every retired plugin prefix is caught, not only this pack's", () => {
    for (const line of ["Use `catalyst-cloud:ask` first.", "Run `/catalyst-pm:plan`."]) {
      expect(findings("planted.md", line).map((f) => f.rule)).toContain("plugin-prefix");
    }
  });

  test("control: what the rules must leave alone", () => {
    const clean = [
      "Create ENG-123 with the `linear` skill (`/linear` in Claude Code, `$linear` in Codex).",
      "Ask the owner; an admin can change it.",
      "Install with `npx skills@latest add coalesce-labs/catalyst-cloud-skills --all -g`.",
      "Run `npx -p @catalyst-cloud/cli catalyst query issue ENG-1`.",
      "```\nthoughts/shared/handoffs/ENG-1/2025-01-08_13-44-55_auth.md\n```",
      "The development pack is `coalesce-labs/catalyst-dev-skills`.",
    ].join("\n");
    expect(findings("clean.md", clean)).toEqual([]);
  });

  test("no skill, README or install block breaks a rule", () => {
    const found = check(repoRoot).map((f) => `${f.file}:${f.line} ${f.rule}  ${f.text}`);
    expect(found).toEqual([]);
  });
});

describe("SKILL.md frontmatter follows the Agent Skills specification", () => {
  const skills = readdirSync(join(repoRoot, "skills")).filter((d) => existsSync(join(repoRoot, "skills", d, "SKILL.md")));
  const front = (d) => {
    const text = readFileSync(join(repoRoot, "skills", d, "SKILL.md"), "utf8");
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    return m ? Bun.YAML.parse(m[1]) : {};
  };

  test("the pack has skills to check", () => {
    expect(skills.length).toBeGreaterThan(30);
  });

  test("every name is lowercase-hyphenated, at most 64 characters, and matches its directory", () => {
    const bad = skills.filter((d) => {
      const name = front(d).name;
      return typeof name !== "string" || name !== d || name.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
    });
    expect(bad).toEqual([]);
  });

  test("every description is non-empty and at most 1024 characters", () => {
    const bad = skills
      .map((d) => [d, String(front(d).description ?? "")])
      .filter(([, desc]) => desc.length === 0 || desc.length > 1024)
      .map(([d, desc]) => `${d}: ${desc.length}`);
    expect(bad).toEqual([]);
  });
});
