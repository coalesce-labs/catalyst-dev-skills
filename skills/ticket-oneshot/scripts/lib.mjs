import { readFileSync, existsSync, statSync, writeFileSync, renameSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const skillRoot = fileURLToPath(new URL("..", import.meta.url));
export const catalog = JSON.parse(readFileSync(join(skillRoot, "stages.json"), "utf8"));
export const stageIndex = new Map(catalog.stages.map((item, index) => [item.stage, index]));
export function ticket() {
  const value = process.env.CATALYST_TICKET;
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(value ?? "")) throw new Error("CATALYST_TICKET must be a ticket id such as CTC-1234");
  return value;
}
export function artifactDir() {
  const dir = process.env.CATALYST_ARTIFACT_DIR;
  if (!dir) throw new Error("CATALYST_ARTIFACT_DIR is required");
  mkdirSync(dir, { recursive: true });
  return resolve(dir);
}
export function inside(root, path) {
  const absolute = resolve(path);
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes ${root}: ${path}`);
  return absolute;
}
// The branch this work left: CATALYST_BASE_REF, else what origin calls its default, else origin/main.
export function baseRef(cwd) {
  if (process.env.CATALYST_BASE_REF) return process.env.CATALYST_BASE_REF;
  const head = spawnSync("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd, encoding: "utf8" }).stdout?.trim();
  // A renamed default branch leaves origin/HEAD naming a branch that is gone.
  const resolves = head && spawnSync("git", ["rev-parse", "--verify", "--quiet", `${head}^{commit}`], { cwd }).status === 0;
  return resolves ? head : "origin/main";
}

export const noBaseMessage = (ref, head) => `no merge base of ${ref} and ${head}. Set CATALYST_BASE_REF to the branch this work left`;

export function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, value);
  renameSync(temp, path);
}
export function readFrontmatter(doc) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(doc);
  if (!match) throw new Error("missing YAML frontmatter");
  const fields = Object.create(null);
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (item) fields[item[1]] = item[2].replace(/^['"]|['"]$/g, "");
  }
  return fields;
}
const headings = {
  research: [/^## Research Question\s*$/im, /^## Summary\s*$/im, /^## Detailed Findings\s*$/im],
  validation: [/^## Requirements\s*$/im],
  plan: [/^## Overview\s*$/im, /^## Acceptance criteria\s*$/im, /^- \*\*AC1\*\*/m, /^## (?:Phases|Phase\s+\d+\b.*)$/im, /^## Files in scope\s*$/im],
};
// Validate's mechanical half: the report accounts for every criterion the plan numbered.
export function requirementProblems(validationPath, planPath) {
  if (!existsSync(planPath)) return [`missing plan: ${planPath}`];
  const section = /^## Requirements\s*$([\s\S]*?)(?=^## |(?![\s\S]))/im.exec(readFileSync(validationPath, "utf8"))?.[1] ?? "";
  const ids = [...new Set([...readFileSync(planPath, "utf8").matchAll(/\*\*(AC\d+)\*\*/g)].map((match) => match[1]))];
  return ids.filter((id) => !new RegExp(`\\b${id}\\b`).test(section)).map((id) => `## Requirements does not account for ${id}`);
}
export function verifyReview(path, head) {
  const errors = [];
  if (!existsSync(path) || !statSync(path).isFile()) return { ok: false, errors: [`missing review artifact: ${path}`] };
  let result;
  try { result = JSON.parse(readFileSync(path, "utf8")); } catch { return { ok: false, errors: ["review-result.json is not valid JSON"] }; }
  if (result?.version !== 1) errors.push("review-result.json version must be 1");
  for (const key of ["reviewed_head", "final_head", "base"]) {
    if (!/^[0-9a-f]{40}$/.test(result?.[key] ?? "")) errors.push(`${key} must be a full 40-character sha`);
  }
  if (head && result?.final_head !== head) errors.push(`final_head must equal HEAD ${head}`);
  if (!Array.isArray(result?.gates) || result.gates.length === 0) errors.push("gates must list every review step");
  if (!Array.isArray(result?.findings)) errors.push("findings must be an array");
  return { ok: errors.length === 0, errors };
}
export function verifyDoc(kind, path, root = process.cwd()) {
  const errors = [];
  if (!existsSync(path) || !statSync(path).isFile()) return { ok: false, errors: [`missing ${kind} artifact: ${path}`] };
  const doc = readFileSync(path, "utf8");
  let fields;
  try { fields = readFrontmatter(doc); } catch (error) { errors.push(error.message); fields = {}; }
  if (fields.source_ticket !== ticket()) errors.push(`source_ticket must be ${ticket()}`);
  if (!fields.repository) errors.push("missing repository frontmatter");
  for (const heading of headings[kind] ?? []) {
    if (!heading.test(doc)) errors.push(`missing required section: ${heading.source}`);
  }
  if (kind === "validation") {
    const ladders = [...doc.matchAll(/```catalyst-validation-ladder\s*\n([\s\S]*?)\n```/g)];
    if (ladders.length !== 1) errors.push(`expected one catalyst-validation-ladder block, found ${ladders.length}`);
    else {
      try {
        const ladder = JSON.parse(ladders[0][1]);
        // A Catalyst Cloud run reads no other version, so a block without it fails there, not here.
        if (ladder?.version !== 1) errors.push(`the ladder must carry "version":1, found ${JSON.stringify(ladder?.version ?? null)}`);
        const steps = ladder?.steps;
        const required = ["plan-conformance", "type-safety", "code-review", "security-review", "security-audit"];
        for (const name of required) {
          const matches = Array.isArray(steps) ? steps.filter((item) => item?.step === name) : [];
          const verdict = matches[0]?.verdict;
          if (matches.length !== 1) errors.push(`the ladder must name ${name} exactly once`);
          else if (name === "plan-conformance" ? verdict !== "PASS" : !["PASS", "SKIPPED"].includes(verdict)) errors.push(`${name} is ${verdict}: ${matches[0].detail ?? "no detail"}`);
        }
      } catch { errors.push("invalid catalyst-validation-ladder JSON"); }
    }
  }
  const refs = [...doc.matchAll(/`([^`\n]+)`/g)]
    .map((match) => match[1])
    .filter((value) => /^[^:\s]+:\d+(?:-\d+)?$/.test(value));
  if (refs.length === 0) errors.push("missing file:line reference: write at least one as `path:line`, in backticks");
  for (const ref of refs) {
    const [, file, line, endLine] = /^(.+):(\d+)(?:-(\d+))?$/.exec(ref) ?? [];
    if (!file || file.includes("://") || file.startsWith("/") || file.split("/").includes("..")) { errors.push(`invalid file:line reference: ${ref}`); continue; }
    const full = resolve(root, file);
    if (!existsSync(full) || !statSync(full).isFile()) { errors.push(`unresolved file:line reference: ${ref}`); continue; }
    const content = readFileSync(full, "utf8");
    const lines = content ? content.split(/\r?\n/).length - (content.endsWith("\n") ? 1 : 0) : 0;
    const first = Number(line);
    const last = Number(endLine ?? line);
    if (first < 1 || last < first || last > lines) errors.push(`line outside file: ${ref}`);
  }
  return { ok: errors.length === 0, errors };
}
export function markerPath(dir, stage, state, attempt) {
  if (!stageIndex.has(stage)) throw new Error(`unknown stage: ${stage}`);
  if (!["start", "done", "fail"].includes(state) || !Number.isSafeInteger(attempt) || attempt < 1) throw new Error("invalid marker state or attempt");
  return join(dir, "stages", `${attempt}-${stage}.${state}.json`);
}
export function readMarker(dir, stage, state) {
  if (!stageIndex.has(stage) || !["start", "done", "fail"].includes(state)) throw new Error("unknown marker stage or state");
  const folder = join(dir, "stages");
  if (!existsSync(folder)) return null;
  const attempts = readdirSync(folder).map((name) => new RegExp(`^([1-9][0-9]*)-${stage}\\.${state}\\.json$`).exec(name)).filter(Boolean).map((match) => Number(match[1]));
  if (!attempts.length) return null;
  const path = markerPath(dir, stage, state, Math.max(...attempts));
  return JSON.parse(readFileSync(path, "utf8"));
}
