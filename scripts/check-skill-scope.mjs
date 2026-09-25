#!/usr/bin/env node
// check-skill-scope.mjs — every skill installs to exactly one scope: the person's home
// directory, never a repository. CTC-2558.
//
// Three things this file proves, in order:
//  1. Ownership: every skill under skills/ is named in packs/skills-ownership.json, with the
//     name its SKILL.md frontmatter actually carries. A skill absent from the manifest fails —
//     there is no --write mode, on purpose (see packs/skills-ownership.json's own comment).
//  2. Scope: nothing in this checkout, and nothing an observed install tree produced, has landed
//     a home-declared skill inside a repository. `observeInstall` scans for the shape the real
//     `skills` CLI writes (any `*/skills/<name>` directory, at any nesting, with no allowlist of
//     agent roots — a real `--all -g` run was observed writing 55 distinct roots) rather than a
//     fixed list of paths, so a new harness the upstream CLI starts supporting is still caught.
//  3. Documentation: the published install commands (`.agents/install-block.md`, the single
//     source, and README.md, its mirror) carry `-g`/`--global` on every `npx skills` add/update
//     line, and README's add command is byte-identical to the canonical block's.
//
// Run:
//   node scripts/check-skill-scope.mjs                       — checks this checkout
//   node scripts/check-skill-scope.mjs --home <dir> --repo <dir>
//                                                             — also checks an observed install

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { skillNames } from "./check-name-collisions.mjs";

export const SCOPES = new Set(["home", "repository"]);
const KNOWN_KEYS = new Set(["comment", "version", "scopes", "skills"]);
const KNOWN_SKILL_KEYS = new Set(["dir", "name", "scope"]);

/** validateOwnership(parsed, label) → { version, skills } or throws naming `label`. */
export function validateOwnership(parsed, label) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`skill-scope: ${label} must be a mapping with a "skills" list`);
  }
  for (const key of Object.keys(parsed)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(`skill-scope: ${label} has an unknown key "${key}" (accepted: ${[...KNOWN_KEYS].join(", ")})`);
    }
  }
  if (parsed.version !== 1) {
    throw new Error(`skill-scope: ${label} "version" must be 1, got ${JSON.stringify(parsed.version)}`);
  }
  const { skills } = parsed;
  if (!Array.isArray(skills)) throw new Error(`skill-scope: ${label} "skills" must be a list`);
  if (skills.length === 0) throw new Error(`skill-scope: ${label} "skills" is empty`);

  const seenDir = new Set();
  const seenName = new Set();
  const out = [];
  for (const entry of skills) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`skill-scope: ${label} "skills" entry ${JSON.stringify(entry)} must be an object`);
    }
    for (const key of Object.keys(entry)) {
      if (!KNOWN_SKILL_KEYS.has(key)) {
        throw new Error(`skill-scope: ${label} skill entry ${JSON.stringify(entry)} has an unknown key "${key}" (accepted: dir, name, scope)`);
      }
    }
    for (const field of ["dir", "name", "scope"]) {
      if (typeof entry[field] !== "string" || entry[field] === "") {
        throw new Error(`skill-scope: ${label} skill entry ${JSON.stringify(entry)} must have a non-empty string "${field}"`);
      }
    }
    if (!SCOPES.has(entry.scope)) {
      throw new Error(`skill-scope: ${label} skill "${entry.dir}" has scope "${entry.scope}"; accepted values are ${[...SCOPES].join(", ")}`);
    }
    if (seenDir.has(entry.dir)) throw new Error(`skill-scope: ${label} has a duplicate dir "${entry.dir}"`);
    seenDir.add(entry.dir);
    if (seenName.has(entry.name)) throw new Error(`skill-scope: ${label} has a duplicate name "${entry.name}"`);
    seenName.add(entry.name);
    out.push({ dir: entry.dir, name: entry.name, scope: entry.scope });
  }
  return { version: parsed.version, skills: out };
}

/** readOwnership(repoDir) → validateOwnership of packs/skills-ownership.json. */
export function readOwnership(repoDir) {
  const path = join(repoDir, "packs", "skills-ownership.json");
  if (!existsSync(path)) throw new Error(`skill-scope: no ${path} — every skill must be declared there (CTC-2558)`);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return validateOwnership(parsed, "packs/skills-ownership.json");
}

/**
 * ownershipProblems(declared, actual) → human-readable problems; [] when every skill is owned,
 * at home scope, with a name matching its frontmatter, in sorted order.
 * `actual` is skillNames(repoDir)'s [{ name, dir }].
 */
export function ownershipProblems(declared, actual) {
  const problems = [];
  const actualByDir = new Map(actual.map((s) => [s.dir, s]));
  const declaredByDir = new Map(declared.map((s) => [s.dir, s]));

  for (const { dir, name } of actual) {
    if (!declaredByDir.has(dir)) {
      problems.push(`skills/${dir} is not in packs/skills-ownership.json — add { "dir": "${dir}", "name": "${name}", "scope": "home" } or delete the skill`);
    }
  }
  for (const { dir, name, scope } of declared) {
    const found = actualByDir.get(dir);
    if (!found) {
      problems.push(`packs/skills-ownership.json names "${dir}", which has no skills/${dir}`);
      continue;
    }
    if (found.name !== name) {
      problems.push(`packs/skills-ownership.json gives skills/${dir} the name "${name}"; its SKILL.md frontmatter name is "${found.name}"`);
    }
    if (scope !== "home") {
      problems.push(`packs/skills-ownership.json declares skills/${dir} "${scope}"-scoped; this bundle ships home scope only (CTC-2558)`);
    }
  }
  const dirs = declared.map((s) => s.dir);
  for (let i = 1; i < dirs.length; i++) {
    if (dirs[i] < dirs[i - 1]) {
      problems.push(`packs/skills-ownership.json entries must be sorted by dir; "${dirs[i]}" comes after "${dirs[i - 1]}"`);
      break;
    }
  }
  return problems;
}

const MAX_SCAN_DEPTH = 8;

/**
 * observeInstall(root) → [{ name, path }] for every <root>/<…>/skills/<name>.
 * Scans for a directory literally named `skills` at any nesting, except `root/skills` itself
 * (this repository's own source tree, so scanning this checkout never flags itself). No
 * allowlist of agent directories: one real `--all -g` run wrote 55 distinct roots (`.claude/`,
 * `.agents/`, `.config/goose/`, `.pi/agent/`, …), and the set grows with the upstream CLI.
 * Does not descend past a matched `skills` directory (its children are the observed skills, not
 * more agent roots), and skips `.git`.
 */
export function observeInstall(root) {
  const out = [];
  const rootSkills = join(root, "skills");
  function walk(dir, depth) {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const full = join(dir, entry.name);
      let isDir;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      if (entry.name === "skills" && full !== rootSkills) {
        for (const child of readdirSync(full, { withFileTypes: true })) {
          const childPath = join(full, child.name);
          try {
            if (!statSync(childPath).isDirectory()) continue;
          } catch {
            continue;
          }
          out.push({ name: child.name, path: childPath });
        }
        continue;
      }
      walk(full, depth + 1);
    }
  }
  walk(root, 0);
  return out;
}

/**
 * repositoryResidue(repoDir) → the paths that only a repository-scoped install creates: every
 * observeInstall() hit, plus skills-lock.json. [] when the directory is clean.
 */
export function repositoryResidue(repoDir) {
  const residue = observeInstall(repoDir).map((s) => s.path);
  const lockPath = join(repoDir, "skills-lock.json");
  if (existsSync(lockPath)) residue.push(lockPath);
  return residue;
}

/**
 * scopeViolations(declared, { home, repository }) → human-readable problems; [] when clean.
 * `home` and `repository` are directory paths (not pre-scanned lists), so this can see
 * skills-lock.json in `repository` in addition to what observeInstall() finds there.
 *  - declared home, found in `repository` → one problem PER COPY,
 *      '"<name>" is declared home-scope but a repository copy is at <path>'. A no-`-g` install
 *      writes the same skill under several agent roots (`.claude/`, `.agents/`, `agent/`, …);
 *      all of them are reported, sorted, because readdirSync order is unspecified and the
 *      person fixing it has to delete every copy, not whichever one was enumerated last.
 *  - declared home, absent from `home`    → '"<name>" is declared home-scope but no copy was installed under $HOME'
 *  - a lockfile in the repository         → 'a repository-scoped install left <path>'
 * `optional` names skills a default install leaves out (`metadata: internal: true`, CTC-3202): their
 * absence from `home` is expected, and a repository copy of one is still reported.
 */
export function scopeViolations(declared, { home, repository, optional = new Set() }) {
  const problems = [];
  const homeNames = new Set(observeInstall(home).map((s) => s.name));
  const repoPathsByName = new Map();
  for (const { name, path } of observeInstall(repository)) {
    const paths = repoPathsByName.get(name);
    if (paths) paths.push(path);
    else repoPathsByName.set(name, [path]);
  }

  for (const { name, scope } of declared) {
    if (scope !== "home") continue;
    const repoPaths = repoPathsByName.get(name);
    if (repoPaths) {
      for (const repoPath of [...repoPaths].sort()) {
        problems.push(`"${name}" is declared home-scope but a repository copy is at ${repoPath}`);
      }
    } else if (!homeNames.has(name) && !optional.has(name)) {
      problems.push(`"${name}" is declared home-scope but no copy was installed under $HOME`);
    }
  }
  const lockPath = join(repository, "skills-lock.json");
  if (existsSync(lockPath)) problems.push(`a repository-scoped install left ${lockPath}`);
  return problems;
}

function fencedShBlocks(text) {
  const blocks = [];
  const re = /```sh\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) blocks.push(m[1]);
  return blocks;
}

function npxSkillsCommandLines(text) {
  return fencedShBlocks(text)
    .flatMap((b) => b.split("\n"))
    .map((l) => l.trim())
    // The `@<version>` pin is OPTIONAL: `npx skills update -y` is the form this repository
    // documented before CTC-2558, and it must still be required to carry -g.
    .filter((l) => /^npx\s+(-y\s+)?skills(@\S+)?\s+(add|update)\b/.test(l));
}

function canonicalAddCommand(canonicalText) {
  return fencedShBlocks(canonicalText)
    .flatMap((b) => b.split("\n"))
    .map((l) => l.trim())
    .find((l) => /^npx\s+skills@\S+\s+add\b/.test(l));
}

/**
 * documentedInstallProblems(repoDir) → problems with the published install commands; [] when clean.
 * Reads .agents/install-block.md (the canonical block, per its own line 3) and README.md, pulls
 * every `npx skills … add|update …` line out of their fenced `sh` code blocks, and requires:
 *  - each such line carries -g or --global (CTC-2558: one scope, the home scope)
 *  - README.md contains the canonical block's add command byte-identical
 * The /plugin marketplace lines are not npx commands and are not checked.
 */
export function documentedInstallProblems(repoDir) {
  const problems = [];
  const canonicalPath = join(repoDir, ".agents", "install-block.md");
  const readmePath = join(repoDir, "README.md");
  if (!existsSync(canonicalPath)) return [`no ${canonicalPath} — the canonical install block is missing`];
  if (!existsSync(readmePath)) return [`no ${readmePath}`];
  const canonical = readFileSync(canonicalPath, "utf8");
  const readme = readFileSync(readmePath, "utf8");

  for (const [label, text] of [[".agents/install-block.md", canonical], ["README.md", readme]]) {
    for (const line of npxSkillsCommandLines(text)) {
      if (!/(^|\s)(-g|--global)(\s|$)/.test(line)) {
        problems.push(`${label}: "${line}" does not carry -g/--global — a documented install must be home-scoped (CTC-2558)`);
      }
    }
  }
  const canonicalAdd = canonicalAddCommand(canonical);
  if (canonicalAdd) {
    const readmeLines = fencedShBlocks(readme).flatMap((b) => b.split("\n")).map((l) => l.trim());
    if (!readmeLines.includes(canonicalAdd)) {
      problems.push(`README.md does not carry the canonical add command from .agents/install-block.md verbatim: "${canonicalAdd}"`);
    }
  }
  return problems;
}

/** documentedCountProblems(repoDir, expected) — the prose in README.md and .agents/install-block.md
 * claims how many skills an install lands ("It installs all N skills …"). CTC-2767: that number was
 * hand-maintained in two files and read by nothing, so the 35th skill left both saying 34 while
 * three hardcoded counts in tests were dutifully bumped. `expected` comes from skills/ on disk,
 * less the internal (operator-only) skills a default install leaves out (CTC-3202).
 * A file that makes no such claim is not a problem — only a claim that disagrees is. */
export function documentedCountProblems(repoDir, expected) {
  const problems = [];
  for (const rel of ["README.md", join(".agents", "install-block.md")]) {
    const path = join(repoDir, rel);
    if (!existsSync(path)) continue;
    for (const m of readFileSync(path, "utf8").matchAll(/It installs all (\d+) skills/g)) {
      if (Number(m[1]) !== expected) {
        problems.push(`${rel}: says it installs ${m[1]} skills, but a default install lands ${expected}`);
      }
    }
  }
  return problems;
}

function report(problems, prefix) {
  for (const p of problems) console.error(`${prefix}  ${p}`);
}

function main(args, repoRoot) {
  const problems = [];

  let declared;
  try {
    declared = readOwnership(repoRoot).skills;
  } catch (e) {
    console.error(`SCOPE-PROBLEM  ${e.message}`);
    console.log("SCOPE: could not read packs/skills-ownership.json");
    return 1;
  }
  const actual = skillNames(repoRoot);
  problems.push(...ownershipProblems(declared, actual));

  for (const path of repositoryResidue(repoRoot)) {
    problems.push(`this checkout carries a repository-scoped install artifact at ${path}`);
  }
  problems.push(...documentedInstallProblems(repoRoot));
  problems.push(...documentedCountProblems(repoRoot, actual.filter((s) => !s.internal).length));

  let homeArg = null;
  let repoArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--home") homeArg = args[++i];
    else if (args[i] === "--repo") repoArg = args[++i];
    else {
      console.error(`Unknown argument "${args[i]}". Usage: node scripts/check-skill-scope.mjs [--home <dir> --repo <dir>]`);
      return 2;
    }
  }
  if (Boolean(homeArg) !== Boolean(repoArg)) {
    console.error("Usage: node scripts/check-skill-scope.mjs [--home <dir> --repo <dir>] (both or neither)");
    return 2;
  }
  if (homeArg && repoArg) {
    const optional = new Set(actual.filter((s) => s.internal).map((s) => s.name));
    problems.push(...scopeViolations(declared, { home: homeArg, repository: repoArg, optional }));
  }

  report(problems, "SCOPE-PROBLEM");
  const repositoryScoped = declared.filter((s) => s.scope !== "home").length;
  console.log(`SCOPE: ${declared.length} skills declared, ${actual.length} in skills/, ${repositoryScoped} repository-scoped; ${problems.length} problem(s)`);
  return problems.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), fileURLToPath(new URL("..", import.meta.url)));
}
