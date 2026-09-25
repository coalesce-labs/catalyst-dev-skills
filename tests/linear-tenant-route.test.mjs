// linear-tenant-route.test.mjs — the tenant-facing `linear` skill reads and writes a tenant's tickets
// only through the Catalyst Cloud CLI. CTC-3202.
//
// Run: bun test tests/linear-tenant-route.test.mjs
//
// A tenant operator who follows `linear` must never be asked for a Linearis command, a personal
// Linear token, or a direct call to Linear's API: those write as the person, skip the tenant's write
// route, and spend the shared API quota. Every write goes through `catalyst-skills write …`, which
// posts to the tenant route as the Catalyst app actor. The operator-only skills (`linearis`,
// `concierge`) keep their Linearis path and are hidden from a default install instead.
//
// Positive control: a planted skill that names each forbidden path must be caught by the same
// matcher, so a clean result on the real tree is not a matcher that stopped matching.

import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export const FORBIDDEN = [
  { name: "a Linearis command or skill", re: /linearis/i },
  { name: "a personal Linear API token", re: /LINEAR_API_(?:TOKEN|KEY)|lin_api_/ },
  { name: "Linear's API host", re: /api\.linear\.app/ },
];

function listFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** offenders(skillDir) → `file: what` for each forbidden path a file in the skill names. */
export function offenders(skillDir) {
  const out = [];
  for (const file of listFiles(skillDir)) {
    const text = readFileSync(file, "utf8");
    for (const f of FORBIDDEN) if (f.re.test(text)) out.push(`${relative(skillDir, file)}: ${f.name}`);
  }
  return out;
}

describe("the linear skill routes tenant ticket work through the Cloud CLI", () => {
  const skillDir = join(repoRoot, "skills", "linear");

  test("control: a planted skill naming each forbidden path is caught", () => {
    const dir = mkdtempSync(join(tmpdir(), "linear-route-"));
    mkdirSync(join(dir, "references"), { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "Run `linearis issues update ENG-1`.\n");
    writeFileSync(join(dir, "references", "setup.md"), "export LINEAR_API_TOKEN=x\ncurl https://api.linear.app/graphql\n");
    const found = offenders(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(found.map((o) => o.split(": ")[1]).sort()).toEqual(FORBIDDEN.map((f) => f.name).sort());
  });

  test("no file in skills/linear names Linearis, a personal Linear token, or Linear's API", () => {
    expect(listFiles(skillDir).length).toBeGreaterThanOrEqual(4);
    expect(offenders(skillDir)).toEqual([]);
  });

  test("every write it teaches is a catalyst-skills write verb", () => {
    const text = listFiles(skillDir)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const verb of ["comment", "state", "label", "create"]) {
      expect(text).toContain(`catalyst-skills write ${verb}`);
    }
    expect(text).toContain("catalyst-skills query issue");
  });

  test("it points tenant ticket work at the Cloud pack", () => {
    const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    expect(skill).toContain("coalesce-labs/catalyst-cloud-skills");
    expect(skill).toContain("catalyst-linear");
  });
});
