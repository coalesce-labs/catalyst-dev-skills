import { readFileSync, existsSync, statSync, writeFileSync, renameSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const skillRoot = fileURLToPath(new URL("..", import.meta.url));
export const catalog = JSON.parse(readFileSync(join(skillRoot, "stages.json"), "utf8"));
export const stageIndex = new Map(catalog.stages.map((item, index) => [item.stage, index]));
export function ticket() {
  const value = process.env.CATALYST_TICKET;
  if (!/^[A-Z]+-\d+$/.test(value ?? "")) throw new Error("CATALYST_TICKET must be a ticket id such as CTC-1234");
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
  plan: [/^## Overview\s*$/im, /^## (?:Implementation Steps|Implementation Plan|Implementation Approach|Phases|Phase\s+\d+\b.*)$/im, /^## (?:Verification|Success Criteria|Testing(?: Strategy.*)?)\s*$/im, /^## Files in scope\s*$/im],
  validation: [/^## (?:Summary|Verdict|Validation Source)\s*$/im, /^(?:##|###) (?:Plan Conformance|Implementation Status)\s*$/im, /^(?:##|###) (?:Review|Code Review Findings)\s*$/im, /^(?:##|###) (?:Gate|Automated Verification Results)\s*$/im],
};
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
    const ladder = /```catalyst-validation-ladder\s*\n([\s\S]*?)\n```/.exec(doc);
    if (!ladder) errors.push("missing catalyst-validation-ladder verdict");
    else {
      try {
        const steps = JSON.parse(ladder[1]).steps;
        const required = ["plan-conformance", "type-safety", "code-review", "security-review", "security-audit"];
        if (!Array.isArray(steps) || required.some((name) => {
          const matches = steps.filter((item) => item?.step === name);
          return matches.length !== 1 || !(
            matches[0].verdict === "PASS" || (name !== "plan-conformance" && matches[0].verdict === "SKIPPED")
          );
        })) errors.push("catalyst-validation-ladder has missing or unsuccessful verdicts");
      } catch { errors.push("invalid catalyst-validation-ladder JSON"); }
    }
  }
  const refs = [...doc.matchAll(/`([^`\n]+\.[a-zA-Z0-9]+:\d+(?:-\d+)?)`/g)].map((match) => match[1]);
  if (refs.length === 0) errors.push("missing file:line reference");
  for (const ref of refs) {
    const [, file, line] = /^(.+):(\d+)(?:-\d+)?$/.exec(ref) ?? [];
    if (!file || file.includes("://") || file.startsWith("/") || file.split("/").includes("..")) { errors.push(`invalid file:line reference: ${ref}`); continue; }
    const full = resolve(root, file);
    if (!existsSync(full) || !statSync(full).isFile()) { errors.push(`unresolved file:line reference: ${ref}`); continue; }
    const content = readFileSync(full, "utf8");
    const lines = content ? content.split(/\r?\n/).length - (content.endsWith("\n") ? 1 : 0) : 0;
    if (lines < Number(line)) errors.push(`line outside file: ${ref}`);
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
