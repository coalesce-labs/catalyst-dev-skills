#!/usr/bin/env node
// vendor.mjs — one source, generated copies.
//
// Every skill runs from its own directory on any harness, so every script and subagent prompt
// it uses lives inside it. A file two skills share keeps ONE source under vendor-src/
// (scripts/…, agents/<name>.md, references/<name>.md, templates/<name>) and each skill lists it
// in `agents/vendor.yaml`. `--write` writes byte-identical copies (keeping the source's mode)
// and records them in `agents/vendor.lock.json`; `--check` (the default) fails on drift. The
// copy never wins: an edited copy is overwritten from its source.
//
// Ported from coalesce-labs/catalyst scripts/packaging/core/vendor.mjs and cli.mjs
// (applyVendoring), where these skills lived before this repository.
//
// Run: node scripts/vendor.mjs --check | --write

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KNOWN_MANIFEST_KEYS = new Set(["files"]);
const LOCK_GENERATED_BY = "catalyst-packaging vendor";

/**
 * vendorDestination(from) → the path the copy takes inside the skill directory.
 *   scripts/<path>       → scripts/<path>   (sibling `source`/import paths keep working)
 *   agents/<name>.md     → assets/agents/<name>.md
 *   references/<name>.md → assets/references/<name>.md
 *   templates/<name>     → assets/templates/<name>
 * Anything else throws, naming the path.
 */
export function vendorDestination(from) {
  if (typeof from !== "string" || from.length === 0) {
    throw new Error(`vendor: source ${JSON.stringify(from)} must be a non-empty string`);
  }
  const parts = from.split("/");
  if (from.startsWith("/") || from.includes("\\") || parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new Error(`vendor: source ${JSON.stringify(from)} must be a contained relative path (no "..", ".", empty or absolute segments)`);
  }
  if (parts[0] === "scripts" && parts.length >= 2) return from;
  if (parts[0] === "agents" && parts.length === 2 && parts[1].endsWith(".md")) return `assets/agents/${parts[1]}`;
  if (parts[0] === "references" && parts.length === 2 && parts[1].endsWith(".md")) return `assets/references/${parts[1]}`;
  if (parts[0] === "templates" && parts.length === 2) return `assets/templates/${parts[1]}`;
  throw new Error(`vendor: source ${JSON.stringify(from)} is not scripts/<path>, agents/<name>.md, references/<name>.md or templates/<name>`);
}

/**
 * parseVendorYaml(text, label) → the parsed manifest. vendor.yaml is one shape — an optional
 * `---`, comments, and a `files:` block list of plain scalars — so this reads exactly that and
 * throws on anything else rather than pulling in a YAML dependency.
 */
export function parseVendorYaml(text, label) {
  const parsed = {};
  let current = null;
  text.split("\n").forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, "");
    if (line === "" || line === "---" || /^\s*#/.test(line)) return;
    const key = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (key) {
      if (key[2] !== "") throw new Error(`vendor: ${label}:${idx + 1} key "${key[1]}" must hold a block list`);
      current = key[1];
      parsed[current] = [];
      return;
    }
    const item = line.match(/^\s+-\s+(.+?)(?:\s+#.*)?$/);
    if (item && current !== null) {
      parsed[current].push(item[1].replace(/^(["'])(.*)\1$/, "$2"));
      return;
    }
    throw new Error(`vendor: ${label}:${idx + 1} is not valid vendor.yaml: ${JSON.stringify(raw)}`);
  });
  return parsed;
}

/** validateVendorManifest(parsed, label) → { files } or throws naming `label`. */
export function validateVendorManifest(parsed, label) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`vendor: ${label} must be a mapping with a "files" list`);
  }
  for (const key of Object.keys(parsed)) {
    if (!KNOWN_MANIFEST_KEYS.has(key)) throw new Error(`vendor: ${label} has an unknown key "${key}" (accepted: files)`);
  }
  const { files } = parsed;
  if (!Array.isArray(files)) throw new Error(`vendor: ${label} "files" must be a list`);
  if (files.length === 0) throw new Error(`vendor: ${label} "files" is empty — delete the manifest instead`);
  const seen = new Set();
  for (const file of files) {
    if (typeof file !== "string") throw new Error(`vendor: ${label} "files" entry ${JSON.stringify(file)} must be a string`);
    vendorDestination(file);
    if (seen.has(file)) throw new Error(`vendor: ${label} lists a duplicate entry "${file}"`);
    seen.add(file);
  }
  return { files: [...files] };
}

/**
 * planVendoredCopies(entries) → { writes, drift, errors, prunes, locks, skillCount }
 *
 * `entries`: [{ skillId, files, sources: { [from]: { base64, mode } | null },
 *               current: { [to]: { base64, mode } }, lock: string[] | null }]
 * - writes: every copy whose bytes or mode differ from the source, or that is missing
 * - prunes: a recorded copy the manifest no longer lists (deleted on write)
 * - locks:  a skill whose lock does not equal its declared copies (rewritten; [] deletes it)
 * - drift:  all of the above — `missing` | `differs` | `mode-differs` | `undeclared` | `lock-stale`
 * - errors: a listed source that does not exist — never silently skipped
 */
export function planVendoredCopies(entries) {
  const writes = [];
  const drift = [];
  const errors = [];
  const prunes = [];
  const locks = [];
  for (const { skillId, files, sources, current, lock } of entries) {
    const declared = files.map((from) => vendorDestination(from));
    for (const from of files) {
      const to = vendorDestination(from);
      const source = sources[from];
      if (!source) {
        errors.push({ skillId, from, reason: "source-missing" });
        continue;
      }
      const existing = current[to];
      if (existing && existing.base64 === source.base64 && existing.mode === source.mode) continue;
      writes.push({ skillId, from, to, base64: source.base64, mode: source.mode });
      const reason = !existing ? "missing" : existing.base64 !== source.base64 ? "differs" : "mode-differs";
      drift.push({ skillId, from, to, reason });
    }
    for (const to of lock ?? []) {
      if (declared.includes(to)) continue;
      if (current[to]) {
        prunes.push({ skillId, to });
        drift.push({ skillId, from: null, to, reason: "undeclared" });
      }
    }
    const wanted = [...declared].sort();
    const recorded = lock ? [...lock].sort() : null;
    if (recorded === null ? wanted.length > 0 : recorded.join("\n") !== wanted.join("\n")) {
      locks.push({ skillId, files: wanted });
      if (!drift.some((d) => d.skillId === skillId)) drift.push({ skillId, from: null, to: "agents/vendor.lock.json", reason: "lock-stale" });
    }
  }
  return { writes, drift, errors, prunes, locks, skillCount: entries.length };
}

const readFileEntry = (path) =>
  existsSync(path) && statSync(path).isFile()
    ? { base64: readFileSync(path).toString("base64"), mode: statSync(path).mode & 0o777 }
    : null;

/**
 * readVendorInputs(repoRoot) → planVendoredCopies' input: one entry per skill under skills/ that
 * has an `agents/vendor.yaml` or an `agents/vendor.lock.json`, with sources read from vendor-src/.
 */
export function readVendorInputs(repoRoot) {
  const skillsRoot = join(repoRoot, "skills");
  const sourceRoot = join(repoRoot, "vendor-src");
  const entries = [];
  for (const skillId of readdirSync(skillsRoot).sort()) {
    const skillDir = join(skillsRoot, skillId);
    if (!existsSync(join(skillDir, "SKILL.md"))) continue;
    const manifestPath = join(skillDir, "agents", "vendor.yaml");
    const lockPath = join(skillDir, "agents", "vendor.lock.json");
    if (!existsSync(manifestPath) && !existsSync(lockPath)) continue;
    const files = existsSync(manifestPath)
      ? validateVendorManifest(parseVendorYaml(readFileSync(manifestPath, "utf8"), manifestPath), manifestPath).files
      : [];
    let lock = null;
    if (existsSync(lockPath)) {
      const parsedLock = JSON.parse(readFileSync(lockPath, "utf8"));
      if (!Array.isArray(parsedLock.files) || parsedLock.files.some((f) => typeof f !== "string")) {
        throw new Error(`vendor: ${lockPath} must carry a "files" list of strings`);
      }
      lock = parsedLock.files;
    }
    const sources = {};
    const current = {};
    for (const from of files) {
      sources[from] = readFileEntry(join(sourceRoot, from));
      const copy = readFileEntry(join(skillDir, vendorDestination(from)));
      if (copy) current[vendorDestination(from)] = copy;
    }
    for (const to of lock ?? []) {
      if (current[to]) continue;
      const copy = readFileEntry(join(skillDir, to));
      if (copy) current[to] = copy;
    }
    entries.push({ skillId, files, sources, current, lock });
  }
  return entries;
}

export function planVendoring(repoRoot) {
  return planVendoredCopies(readVendorInputs(repoRoot));
}

/** applyVendoring(repoRoot) — writes every planned copy (keeping the source's mode); throws on a missing source. */
export function applyVendoring(repoRoot) {
  const plan = planVendoring(repoRoot);
  if (plan.errors.length > 0) {
    throw new Error(`vendor: ${plan.errors.map((e) => `skills/${e.skillId}: ${e.from} (${e.reason})`).join("; ")}`);
  }
  const skillDir = (skillId) => resolve(repoRoot, "skills", skillId);
  for (const w of plan.writes) {
    const dest = join(skillDir(w.skillId), w.to);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(w.base64, "base64"));
    chmodSync(dest, w.mode);
  }
  for (const p of plan.prunes) rmSync(join(skillDir(p.skillId), p.to), { force: true });
  for (const l of plan.locks) {
    const lockPath = join(skillDir(l.skillId), "agents/vendor.lock.json");
    if (l.files.length === 0) rmSync(lockPath, { force: true });
    else writeFileSync(lockPath, JSON.stringify({ generatedBy: LOCK_GENERATED_BY, files: l.files }, null, 2) + "\n");
  }
  return plan;
}

function main(args, repoRoot) {
  if (args.includes("--write")) {
    const plan = applyVendoring(repoRoot);
    console.log(`VENDOR: ${plan.skillCount} skill(s), wrote ${plan.writes.length} copy(ies), pruned ${plan.prunes.length}`);
    for (const w of plan.writes) console.log(`  skills/${w.skillId}/${w.to}  ← vendor-src/${w.from}`);
    for (const p of plan.prunes) console.log(`  pruned skills/${p.skillId}/${p.to} (no longer in agents/vendor.yaml)`);
    return 0;
  }
  const unknown = args.filter((a) => a !== "--check");
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(" ")}. Usage: node scripts/vendor.mjs [--check | --write]`);
    return 2;
  }
  const plan = planVendoring(repoRoot);
  for (const e of plan.errors) console.error(`ERROR  skills/${e.skillId}: ${e.from} (${e.reason})`);
  for (const d of plan.drift) console.error(`DRIFT  skills/${d.skillId}/${d.to} ${d.reason}${d.from ? ` (source vendor-src/${d.from})` : ""}`);
  console.log(`VENDOR: ${plan.skillCount} skill(s), ${plan.drift.length} drifted, ${plan.errors.length} error(s)`);
  if (plan.errors.length > 0 || plan.drift.length > 0) {
    console.error("Run 'node scripts/vendor.mjs --write' and commit the copies — edit the source under vendor-src/, never a copy.");
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), fileURLToPath(new URL("..", import.meta.url)));
}
