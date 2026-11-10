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

// A subagent's `tools:` line is all it may call. Instructions that say "run `ls …`" need Bash, as
// a plain grant or a `Bash(ls *)` pattern; an empty `tools:` inherits every tool. A helper that was
// told to run a command it could not call failed its first step with "No such tool available".
const RUN_COMMAND = /\brun `([a-z][a-z0-9-]*)[ `]/g;

/** missingShell(markdown) → each command the instructions say to run that the tools line cannot run. */
export function missingShell(markdown) {
  const front = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const toolsLine = front.match(/^tools:(.*)$/m)?.[1].trim() ?? "";
  if (toolsLine === "") return [];
  const tools = toolsLine.split(",").map((t) => t.trim());
  const body = markdown.slice(front.length);
  return [...new Set([...body.matchAll(RUN_COMMAND)].map((m) => m[1]))].filter(
    (cmd) => !tools.includes("Bash") && !tools.includes(`Bash(${cmd} *)`),
  );
}

describe("plugin subagents", () => {
  test("control: a helper told to run ls without Bash is caught, and Bash(ls *) satisfies it", () => {
    const told = "Before doing anything else, run `ls thoughts/shared/` to verify it exists.";
    expect(missingShell(`---\nname: x\ntools: Grep, Glob, LS\n---\n${told}`)).toEqual(["ls"]);
    expect(missingShell(`---\nname: x\ntools: Grep, Glob, LS, Bash(ls *)\n---\n${told}`)).toEqual([]);
    expect(missingShell(`---\nname: x\ntools: Grep, Bash\n---\n${told}`)).toEqual([]);
    expect(missingShell(`---\nname: x\ntools:\n---\n${told}`)).toEqual([]);
  });

  test("every plugin agent can run each command its instructions tell it to run", () => {
    const agentsDir = join(repoRoot, "agents");
    const gaps = readdirSync(agentsDir)
      .filter((f) => f.endsWith(".md"))
      .flatMap((f) => missingShell(readFileSync(join(agentsDir, f), "utf8")).map((cmd) => `agents/${f} ${cmd}`));
    expect(gaps).toEqual([]);
  });

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

  // CTC-3733: the catalyst-dev plugin is deleted at install, so `/catalyst-dev:<skill>` is an unknown
  // command in Claude Code and means nothing in Codex or OpenCode. Name the skill in words instead.
  test("no skill tells the reader to type a /catalyst-dev:<skill> slash command", () => {
    const slash = new RegExp(`/${REFERENCE.source}`, "g");
    const hits = listFiles(skillsRoot).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, idx) => [...line.matchAll(slash)].map((m) => `${relative(repoRoot, file)}:${idx + 1} ${m[0]}`)),
    );
    expect(hits).toEqual([]);
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
