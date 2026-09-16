// name-collisions.test.mjs — the collision check sees a collision, and this repository has none inside it.
//
// Run: bun test tests/name-collisions.test.mjs

import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { collisions, skillNames } from "../scripts/check-name-collisions.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "name-collisions-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function fixtureRepo(label, skills) {
  const root = join(scratch, label);
  for (const [dir, name] of Object.entries(skills)) {
    mkdirSync(join(root, "skills", dir), { recursive: true });
    writeFileSync(join(root, "skills", dir, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\nbody\n`);
  }
  return root;
}

describe("collision check", () => {
  test("control: a name shared with another pack is reported", () => {
    const other = fixtureRepo("other", { "whats-happening": "whats-happening", "x": "commit" });
    const problems = collisions(skillNames(repoRoot), [{ label: "other", skills: skillNames(other) }]);
    expect(problems).toEqual([expect.stringContaining('"commit"')]);
  });

  test("control: a duplicate inside one repository is reported", () => {
    const repo = fixtureRepo("dup", { a: "same", b: "same" });
    expect(collisions(skillNames(repo), [])).toEqual([expect.stringContaining("duplicate")]);
  });

  test("the installed folder name is the frontmatter name, which may differ from the directory", () => {
    const ours = skillNames(repoRoot);
    expect(ours.length).toBe(33);
    expect(ours.find((s) => s.dir === "linearis")?.name).toBe("linearis-cli");
    expect(collisions(ours, [])).toEqual([]);
  });
});
