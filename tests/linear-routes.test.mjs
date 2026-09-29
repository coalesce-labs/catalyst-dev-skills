// linear-routes.test.mjs — Linear work on a cloud account goes through the catalyst CLI; linearis-cli
// holds only the operations that route cannot do, and off-cloud work.
//
// Run: bun test tests/linear-routes.test.mjs
//
// The catalyst CLI reads a ticket, lists and filters tickets, projects and cycles, searches, and
// queries the replica; it writes comments, slot moves, labels, new tickets, reactions, attachments
// and agent sessions. What it cannot do (relations, editing a ticket after it exists, cycle and
// milestone writes, assignment) and a workspace with no cloud account are linearis-cli's exceptions.

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(repoRoot, p), "utf8");
function prose(skill) {
  const dir = join(repoRoot, "skills", skill);
  const refs = join(dir, "references");
  const files = [join(dir, "SKILL.md"), ...(existsSync(refs) ? readdirSync(refs).filter((f) => f.endsWith(".md")).map((f) => join(refs, f)) : [])];
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}

const linearis = read("skills/linearis-cli/SKILL.md");

describe("linearis-cli is the exception, not the route", () => {
  test("cloud reads, lists and searches go through the catalyst CLI", () => {
    for (const verb of ["catalyst query issue", "catalyst query issues", "catalyst query search"]) expect(linearis).toContain(verb);
  });

  test("it names each operation the catalyst route cannot do", () => {
    for (const re of [/relation/i, /after it exists/i, /cycle/i, /milestone/i, /assign/i, /no cloud account/i]) expect(linearis).toMatch(re);
  });

  test("it no longer claims lists and searches need linearis", () => {
    expect(linearis).not.toMatch(/no bulk-query replica form|list\/search still goes through `linearis`/);
    expect(read("skills/linearis-cli/references/reading-linear-detail.md")).not.toMatch(/## Still needs linearis/);
  });

  test("its stage table is not an instruction to move cards, and no coding skill is said to use it", () => {
    expect(linearis).toMatch(/not an instruction to move/i);
    for (const skill of ["create-plan", "implement-plan", "create-pr", "research-codebase"]) expect(linearis).not.toContain(`\`${skill}\``);
  });

  test("it describes no `catalyst-linear` command, which would collide with the Cloud skill of that name", () => {
    expect(prose("linearis-cli")).not.toMatch(/`catalyst-linear` (wrapper|command)/);
  });
});

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
