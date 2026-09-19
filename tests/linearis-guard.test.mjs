// linearis-guard.test.mjs — every skill that uses linearis says when to skip it.
//
// Run: bun test tests/linearis-guard.test.mjs
//
// The cloud runner loads these skills inside a phase container, which sets CATALYST_PHASE, holds no
// Linear credential and usually has no linearis binary; the runner owns the ticket write-back there.
// A skill that calls linearis without saying so fails or stalls in the container. So every skill
// whose files mention linearis must carry, in its SKILL.md or a reference, one paragraph that names
// both skip conditions: CATALYST_PHASE being set, and linearis being unavailable
// (`command -v linearis` failing). The wording follows research-codebase and implement-plan.
//
// Positive controls: fixture skills with a partial or missing guard must fail, so a clean result on
// the real tree is not a checker that stopped looking.

import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const skillsRoot = join(repoRoot, "skills");

const PHASE_SKIP = /CATALYST_PHASE/;
const CLI_ABSENT = /command -v linearis|linearis CLI is not available|linearis is not (?:installed|available|on PATH)/i;
const SKIP_WORD = /\bskip/i;

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** mentionsLinearis(skillDir) → true when any file in the skill names linearis. */
export function mentionsLinearis(skillDir) {
  return listFiles(skillDir).some((f) => /linearis/i.test(readFileSync(f, "utf8")));
}

/**
 * guardParagraphs(skillDir) → the prose paragraphs (SKILL.md and references/*.md, split on blank
 * lines) that name both skip conditions and say to skip.
 */
export function guardParagraphs(skillDir) {
  const prose = [join(skillDir, "SKILL.md"), ...listFiles(join(skillDir, "references"))].filter(
    (f) => existsSync(f) && f.endsWith(".md")
  );
  return prose.flatMap((f) =>
    readFileSync(f, "utf8")
      .split(/\n\s*\n/)
      .filter((p) => PHASE_SKIP.test(p) && CLI_ABSENT.test(p) && SKIP_WORD.test(p))
      .map((p) => ({ file: f.slice(skillDir.length + 1), text: p }))
  );
}

const scratch = mkdtempSync(join(tmpdir(), "linearis-guard-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function fixtureSkill(name, files) {
  const dir = join(scratch, name);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

describe("the lint sees what it exists to catch (positive controls)", () => {
  test("a skill that runs linearis with no guard has no guard paragraph", () => {
    const dir = fixtureSkill("no-guard", { "SKILL.md": "---\nname: x\n---\nRun `linearis issues read X`.\n" });
    expect(mentionsLinearis(dir)).toBe(true);
    expect(guardParagraphs(dir)).toEqual([]);
  });

  test("naming only one skip condition is not a guard", () => {
    const dir = fixtureSkill("half-guard", {
      "SKILL.md": "---\nname: x\n---\nRun linearis. Skip this when `CATALYST_PHASE` is set.\n\nIf `command -v linearis` fails, continue.\n",
    });
    expect(guardParagraphs(dir)).toEqual([]);
  });

  test("a linearis mention only in a script still counts as a mention", () => {
    const dir = fixtureSkill("script-only", {
      "SKILL.md": "---\nname: x\n---\nno commands\n",
      "scripts/a.sh": "#!/usr/bin/env bash\nlinearis issues read X\n",
    });
    expect(mentionsLinearis(dir)).toBe(true);
  });

  test("a paragraph in a reference naming both conditions is a guard", () => {
    const dir = fixtureSkill("ref-guard", {
      "SKILL.md": "---\nname: x\n---\nSee references/linear.md.\n",
      "references/linear.md": "Skip every linearis call when `CATALYST_PHASE` is set or `command -v linearis` fails.\n",
    });
    expect(guardParagraphs(dir).map((g) => g.file)).toEqual(["references/linear.md"]);
  });
});

describe("every skill that uses linearis carries the phase-container guard", () => {
  const skills = readdirSync(skillsRoot)
    .filter((name) => existsSync(join(skillsRoot, name, "SKILL.md")))
    .sort();
  const users = skills.filter((name) => mentionsLinearis(join(skillsRoot, name)));

  test("the set of linearis users is read from the tree, not an empty listing", () => {
    expect(skills.length).toBeGreaterThanOrEqual(35);
    expect(users).toContain("research-codebase");
    expect(users.length).toBeGreaterThanOrEqual(15);
  });

  for (const skill of users) {
    test(`${skill}: documents a skip when CATALYST_PHASE is set or linearis is unavailable`, () => {
      expect(guardParagraphs(join(skillsRoot, skill)).length).toBeGreaterThan(0);
    });
  }
});
