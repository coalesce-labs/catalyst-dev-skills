#!/usr/bin/env node
// The review's last step: write review-result.json from the reviewer's draft, so the file is never
// typed by hand. It fills in what git and the step receipts already know (the head, each review step
// that ran and when, the summary counts) and writes a seal beside the file. A gate that reads the file
// checks the seal (ticket-oneshot's verifyReview, which keeps its own copy of the seal's path and
// hash so each skill installs alone), so a file written or edited without this script is refused.
//
// The seal is a sha256 the writer could compute itself, so it stops a shortcut, not a forgery.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RECORDER = "review-and-verify/scripts/record-result.mjs";

/** The seal's path for a result file: review-result.json -> review-result.seal.json. */
export const sealPath = (path) => `${path.replace(/\.json$/, "")}.seal.json`;
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const VERDICTS = { valid: "fixed", invalid: "invalid", "already-fixed": "invalid", deferred: "deferred", "needs-human": "needs_human" };
export function summarize(findings) {
  const summary = { found: findings.length, fixed: 0, invalid: 0, deferred: 0, needs_human: 0 };
  for (const finding of findings) {
    const key = VERDICTS[finding?.verdict];
    if (key) summary[key] += 1;
  }
  return summary;
}

/** Each review step a session ran at one of these heads, read from its receipt. */
export function stepsRan(reviewsDir, heads) {
  if (!existsSync(reviewsDir)) return [];
  const steps = [];
  for (const name of readdirSync(reviewsDir).sort()) {
    if (!name.endsWith(".json")) continue;
    let receipt;
    try { receipt = JSON.parse(readFileSync(join(reviewsDir, name), "utf8")); } catch { continue; }
    if (typeof receipt?.skill !== "string" || typeof receipt?.step !== "string" || !heads.includes(receipt.head)) continue;
    steps.push({ skill: receipt.skill, step: receipt.step, base: receipt.base, head: receipt.head, verdict: receipt.verdict, at: receipt.at });
  }
  return steps.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** The result for a draft. Fields the reviewer gave are kept as given; checking them is the gate's job. */
export function buildResult(draft, { head, reviewsDir, now = new Date() }) {
  if (draft === null || typeof draft !== "object" || Array.isArray(draft)) throw new Error("the draft must be one JSON object");
  const findings = Array.isArray(draft.findings) ? draft.findings : [];
  const finalHead = draft.final_head ?? head;
  const heads = [draft.reviewed_head, finalHead].filter((value) => typeof value === "string");
  return {
    version: 1,
    ...draft,
    final_head: finalHead,
    findings,
    steps: stepsRan(reviewsDir, heads),
    summary: summarize(findings),
    recorded: { by: RECORDER, at: now.toISOString(), head },
  };
}

function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

/** Writes the result and its seal. The seal names the exact bytes, so a later edit breaks it. */
export function recordResult(draft, { out, head, reviewsDir, now }) {
  const result = buildResult(draft, { head, reviewsDir, now });
  const text = JSON.stringify(result, null, 2) + "\n";
  atomicWrite(out, text);
  atomicWrite(sealPath(out), JSON.stringify({ by: RECORDER, sha256: sha256(text), final_head: result.final_head, at: result.recorded.at }, null, 2) + "\n");
  return result;
}

function main(argv) {
  const arg = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  const draftPath = arg("--draft");
  if (!draftPath) { process.stderr.write("usage: record-result.mjs --draft <draft.json> [--out <review-result.json>]\n"); return 2; }
  let draft;
  try { draft = JSON.parse(readFileSync(draftPath, "utf8")); } catch (error) { process.stderr.write(`cannot read the draft ${draftPath}: ${error.message}\n`); return 2; }
  let head;
  try { head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { process.stderr.write("cannot read HEAD: run this in the reviewed checkout\n"); return 2; }
  const dir = process.env.CATALYST_ARTIFACT_DIR ? resolve(process.env.CATALYST_ARTIFACT_DIR) : null;
  const out = arg("--out") ? resolve(arg("--out")) : dir ? join(dir, "review-result.json") : null;
  const reviewsDir = join(dir ?? (out ? dirname(out) : process.cwd()), "reviews");
  try {
    if (!out) { process.stdout.write(JSON.stringify(buildResult(draft, { head, reviewsDir }), null, 2) + "\n"); return 0; }
    const result = recordResult(draft, { out, head, reviewsDir });
    process.stdout.write(`recorded ${out}: ${result.steps.length} review steps, ${result.summary.found} findings\n`);
    return 0;
  } catch (error) { process.stderr.write(`${error.message}\n`); return 1; }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
