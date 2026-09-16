// plugin-agents.test.mjs — every `catalyst-dev:<name>` a skill tells Claude Code to use exists in
// the plugin.
//
// Run: bun test tests/plugin-agents.test.mjs
//
// The runner loads this repository with `claude --plugin-dir`, as the `catalyst-dev` plugin. Claude
// Code reads subagents from `agents/*.md` at the plugin root, so `catalyst-dev:codebase-locator`
// exists only if `agents/codebase-locator.md` does. Two shapes of reference are checked:
//   - a literal `catalyst-dev:<name>` anywhere under skills/ must name a skill or a plugin agent;
//   - a skill that carries a subagent prompt (`agents/<name>.md` in its vendor.yaml) says "spawn
//     them as `catalyst-dev:<name>`", so each of those names must be a plugin agent too.

import { describe, test, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parseVendorYaml } from "../scripts/vendor.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const skillsRoot = join(repoRoot, "skills");

// A name ending in "-" is a template prefix (`catalyst-dev:phase-*`), not a reference.
const REFERENCE = /catalyst-dev:([a-z][a-z0-9-]*[a-z0-9])(?![a-z0-9-]|\*)/g;

function listFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** unresolved(root) → `file:line name` for each reference that names neither a skill nor an agent. */
export function unresolved(root) {
  const skills = new Set(readdirSync(join(root, "skills")).filter((d) => existsSync(join(root, "skills", d, "SKILL.md"))));
  const isAgent = (name) => existsSync(join(root, "agents", `${name}.md`));
  const out = [];
  for (const file of listFiles(join(root, "skills"))) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, idx) => {
        for (const [, name] of line.matchAll(REFERENCE)) {
          if (!skills.has(name) && !isAgent(name)) out.push(`${relative(root, file)}:${idx + 1} ${name}`);
        }
      });
  }
  for (const skill of skills) {
    const manifest = join(root, "skills", skill, "agents", "vendor.yaml");
    if (!existsSync(manifest)) continue;
    for (const from of parseVendorYaml(readFileSync(manifest, "utf8"), manifest).files) {
      const m = from.match(/^agents\/([^/]+)\.md$/);
      if (m && !isAgent(m[1])) out.push(`skills/${skill}/agents/vendor.yaml ${m[1]}`);
    }
  }
  return out;
}

describe("plugin subagents", () => {
  test("control: the reference pattern skips a template prefix and catches a real name", () => {
    const line = "run /catalyst-dev:phase-* then spawn catalyst-dev:codebase-locator and `catalyst-dev:commit`";
    expect([...line.matchAll(REFERENCE)].map((m) => m[1])).toEqual(["codebase-locator", "commit"]);
  });

  test("the skills do reference plugin subagents (the check has something to check)", () => {
    const vendored = readdirSync(skillsRoot).filter((s) => existsSync(join(skillsRoot, s, "assets", "agents")));
    expect(vendored).toContain("research-codebase");
  });

  test("every catalyst-dev:<name> a skill uses is a skill or an agents/<name>.md at the plugin root", () => {
    expect(unresolved(repoRoot)).toEqual([]);
  });

  // Claude Code loads every agents/*.md as a subagent, so a README there becomes `catalyst-dev:README`.
  test("every agents/*.md is a Claude Code agent file with a matching frontmatter name", () => {
    const agentsDir = join(repoRoot, "agents");
    const files = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith(".md")) : [];
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const front = readFileSync(join(agentsDir, f), "utf8").match(/^---\n([\s\S]*?)\n---/);
      expect(front?.[1].match(/^name:\s*(\S+)/m)?.[1]).toBe(f.replace(/\.md$/, ""));
    }
  });
});
