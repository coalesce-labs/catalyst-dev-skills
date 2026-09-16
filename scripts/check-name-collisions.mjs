#!/usr/bin/env node
// check-name-collisions.mjs — no two installed skills may share a name.
//
// `npx skills add` installs each skill into a folder named by its frontmatter `name`, so a skill
// here named like one in another Coalesce Labs pack (catalyst-cloud-skills, catalyst-pm-skills)
// overwrites it on a machine that installs both. This compares this repository's names with the
// checkouts passed as arguments, and also refuses a duplicate inside this repository.
//
// Run: node scripts/check-name-collisions.mjs <other-skills-repo-dir>...

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** skillNames(repoDir) → [{ name, dir }] for every skills/<dir>/SKILL.md with a frontmatter name. */
export function skillNames(repoDir) {
  const skillsRoot = join(repoDir, "skills");
  if (!existsSync(skillsRoot)) throw new Error(`no skills/ directory in ${repoDir}`);
  const out = [];
  for (const dir of readdirSync(skillsRoot).sort()) {
    const file = join(skillsRoot, dir, "SKILL.md");
    if (!existsSync(file)) continue;
    const front = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/);
    const name = front?.[1].match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1];
    if (!name) throw new Error(`${file} has no frontmatter name`);
    out.push({ name, dir });
  }
  return out;
}

/** collisions(ours, others) → human-readable problems; [] when every name is unique. */
export function collisions(ours, others) {
  const problems = [];
  const seen = new Map();
  for (const { name, dir } of ours) {
    if (seen.has(name)) problems.push(`duplicate name "${name}" in this repository: skills/${seen.get(name)} and skills/${dir}`);
    seen.set(name, dir);
  }
  for (const { label, skills } of others) {
    for (const { name, dir } of skills) {
      if (seen.has(name)) problems.push(`"${name}" (skills/${seen.get(name)}) collides with ${label} skills/${dir}`);
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const otherDirs = process.argv.slice(2);
  if (otherDirs.length === 0) {
    console.error("Usage: node scripts/check-name-collisions.mjs <other-skills-repo-dir>...");
    process.exit(2);
  }
  const ours = skillNames(repoRoot);
  const others = otherDirs.map((d) => ({ label: d, skills: skillNames(d) }));
  const problems = collisions(ours, others);
  for (const p of problems) console.error(`COLLISION  ${p}`);
  console.log(`NAMES: ${ours.length} here, ${others.map((o) => `${o.skills.length} in ${o.label}`).join(", ")}; ${problems.length} collision(s)`);
  process.exit(problems.length > 0 ? 1 : 0);
}
