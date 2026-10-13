import { readFileSync, existsSync, statSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
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
  research: [["Research Question"], ["Summary"], ["Detailed Findings"]],
  plan: [["Overview"], ["Implementation Steps", "Implementation Plan", "Phases"], ["Verification", "Success Criteria", "Testing"], ["Files in scope"]],
  validation: [["Summary", "Verdict"], ["Plan Conformance"], ["Type Safety"], ["Review"], ["Security"], ["Gate"]],
};
export function verifyDoc(kind, path, root = process.cwd()) {
  const errors = [];
  if (!existsSync(path) || !statSync(path).isFile()) return { ok: false, errors: [`missing ${kind} artifact: ${path}`] };
  const doc = readFileSync(path, "utf8");
  let fields;
  try { fields = readFrontmatter(doc); } catch (error) { errors.push(error.message); fields = {}; }
  if (fields.source_ticket !== ticket()) errors.push(`source_ticket must be ${ticket()}`);
  if (!fields.repository) errors.push("missing repository frontmatter");
  for (const group of headings[kind] ?? []) {
    if (!group.some((heading) => new RegExp(`^## ${heading}\\s*$`, "im").test(doc))) errors.push(`missing required section: ${group.join(" or ")}`);
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
export function markerPath(dir, stage, state) {
  const index = stageIndex.get(stage);
  if (index === undefined) throw new Error(`unknown stage: ${stage}`);
  return join(dir, "stages", `${index + 1}-${stage}.${state}.json`);
}
export function readMarker(dir, stage, state) {
  const path = markerPath(dir, stage, state);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}
