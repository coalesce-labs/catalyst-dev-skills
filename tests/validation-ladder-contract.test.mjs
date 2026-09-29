// validation-ladder-contract.test.mjs — validate-plan writes the ladder block that remediate-plan
// reads, with the step ids and verdicts a Catalyst Cloud run parses.
//
// Run: bun test tests/validation-ladder-contract.test.mjs
//
// The step ids and verdicts mirror the cloud runner's parser (LADDER_STEPS and LADDER_VERDICTS);
// a change there must change this list, the reference and both skills together.

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(repoRoot, p), "utf8");

const STEPS = ["plan-conformance", "type-safety", "code-review", "security-review", "security-audit"];
const VERDICTS = ["PASS", "FAIL", "SKIPPED", "UNAVAILABLE", "ENVIRONMENT_GAP", "UNREPORTED"];

const validate = read("skills/validate-plan/SKILL.md");
const reference = validate.split("## The validation ladder block")[1] ?? "";
const remediate = read("skills/remediate-plan/SKILL.md");

describe("the validation ladder contract", () => {
  test("the reference's example block parses and names every step once, in order", () => {
    const block = reference.match(/```catalyst-validation-ladder\n([\s\S]*?)\n```/);
    expect(block).not.toBeNull();
    const ladder = JSON.parse(block[1]);
    expect(ladder.version).toBe(1);
    expect(ladder.steps.map((s) => s.step)).toEqual(STEPS);
    for (const s of ladder.steps) expect(VERDICTS).toContain(s.verdict);
  });

  test("the reference names every verdict a reader accepts", () => {
    for (const v of VERDICTS) expect(reference).toContain(`\`${v}\``);
  });

  test("validate-plan ends its report with the block and defines it", () => {
    expect(reference.length).toBeGreaterThan(0);
    expect(validate).toContain("catalyst-validation-ladder");
  });

  test("validate-plan hands a failing report to remediate-plan", () => {
    expect(validate).toMatch(/`remediate-plan`/);
  });

  test("remediate-plan reads the ladder block and acts only on FAIL steps", () => {
    expect(remediate).toContain("catalyst-validation-ladder");
    expect(remediate).toContain("The validation ladder block");
    expect(remediate).toMatch(/FAIL/);
    expect(remediate).toMatch(/plan-only/);
    expect(remediate).toMatch(/preexisting/);
  });

  test("both skills run the repo's own gates, not a hardcoded command", () => {
    for (const text of [validate, remediate]) {
      expect(text).not.toMatch(/make check test|`bun run check`/);
    }
  });
});
