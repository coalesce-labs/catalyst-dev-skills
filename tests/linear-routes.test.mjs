// linear-routes.test.mjs — Linear work on a cloud account goes through the catalyst CLI; the
// Linearis CLI holds only the operations that route cannot do, and off-cloud work.
//
// Run: bun test tests/linear-routes.test.mjs
//
// The catalyst CLI reads a ticket, lists and filters tickets, projects and cycles, searches, and
// queries the replica; it writes comments, slot moves, labels, new tickets, reactions, attachments
// and agent sessions. What it cannot do (relations, editing a ticket after it exists, cycle and
// milestone writes, assignment) and a workspace with no cloud account are an operator's exceptions,
// done with the Linearis CLI directly. The Linearis reference itself lives in the operators' pack.

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
function prose(skill) {
  const dir = join(repoRoot, "skills", skill);
  const refs = join(dir, "references");
  const files = [join(dir, "SKILL.md"), ...(existsSync(refs) ? readdirSync(refs).filter((f) => f.endsWith(".md")).map((f) => join(refs, f)) : [])];
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}

describe("customer-facing skills read tickets through the catalyst CLI", () => {
  const CODING = ["research-codebase", "create-plan", "implement-plan", "create-pr", "describe-pr", "merge-pr", "gherkin-ticket"];

  for (const skill of CODING) {
    test(`${skill} points at no transition table`, () => {
      expect(prose(skill)).not.toMatch(/status-transitions|Status Transitions|transition table|linear-transition/);
    });
  }

  for (const skill of ["describe-pr", "gherkin-ticket"]) {
    test(`${skill} reads a ticket with catalyst query issue on a cloud account`, () => {
      expect(prose(skill)).toContain("catalyst query issue");
    });
  }
});

describe("no skill here describes a `catalyst-linear` command", () => {
  // It would collide with the Cloud pack's skill of that name.
  const skills = readdirSync(join(repoRoot, "skills")).filter((d) => existsSync(join(repoRoot, "skills", d, "SKILL.md")));
  for (const skill of skills) {
    test(`${skill}`, () => {
      expect(prose(skill)).not.toMatch(/`catalyst-linear` (wrapper|command)/);
    });
  }
});
