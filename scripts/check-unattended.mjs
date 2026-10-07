#!/usr/bin/env node
// check-unattended.mjs — a skill never asks and waits when it runs as a pipeline phase. CTC-5182.
//
// The Catalyst Cloud runner dispatches skills single-shot with `CATALYST_PHASE` set: there is no
// second turn, so a session that replies "I'm ready…" and waits ends with nothing written. That
// stalled research phases on 2026-09-01. The runner used to cancel the waits with prompt text and
// scan these skill bodies for the phrases it cancelled; now each skill states the rule itself, and
// this check is the one test that holds it.
//
// THE RULE, applied to the SKILL.md, references/*.md and assets/references/*.md of each skill a
// pipeline phase runs (PHASE_SKILLS, the same six names as catalyst-cloud's PHASE_SKILL_NAMES) and
// of each skill a phase session runs along the way (IN_SESSION_SKILLS); a skill that starts being
// run that way joins its list in the same change:
//   1. Every line that tells the session to wait for, or ask, a person is GUARDED: it names
//      `CATALYST_PHASE` and says what unattended mode does instead (never ask, skip, stop, proceed),
//      or an earlier line in the same `##` section is a guard, one that names `CATALYST_PHASE` and
//      says not to ask or wait. A guard after the wait, or in another section, does not count.
//   2. Every phase skill that can wait PRINTS the mode in a bash block before its first possible
//      wait, so the session observes it rather than having to remember to check.
//
// Run: node scripts/check-unattended.mjs   (exits 1 naming each unguarded line)

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The skills a Catalyst Cloud pipeline phase runs, one per phase (catalyst-cloud's
 *  PHASE_SKILL_NAMES). Each states the rule and prints the mode before its first possible wait. */
export const PHASE_SKILLS = Object.freeze([
  "research-codebase",
  "create-plan",
  "implement-plan",
  "validate-plan",
  "describe-pr",
  "remediate-plan",
]);

/** Skills a phase session runs in the course of its work. They have no ask or wait step today;
 *  scanning them keeps it that way. */
export const IN_SESSION_SKILLS = Object.freeze([
  "unslop",
  "validate-type-safety",
  "scan-reward-hacking",
  "review-code",
  "review-security",
  "fix-typescript",
]);

/** Every skill the scan covers. Interactive-only skills (the browser login flow, merge
 *  confirmations) are out of scope: no phase runs them. */
export const DISPATCHED_SKILLS = Object.freeze([...PHASE_SKILLS, ...IN_SESSION_SKILLS]);

/** Lines that tell the session to wait for, or ask, a person. */
const WAIT_OR_ASK = [
  /\bwait(s|ing)?\b[^.]*\b(user|person|their|reply|answer|query|question|pick|confirm|approv)/i,
  /\b(reply|respond)\b[^.]*\bthen wait\b/i,
  /\[Y\/n\]/,
  /\bask (whether|for the task|the user|the person|them|which)\b/i,
  // "and ask" / "ask:" forms. A quoted phrase is another text being described (the vendored
  // review reference quotes an upstream "stop and ask your human partner"), and asking yourself
  // a question is not asking a person, so neither counts.
  { test: (l) => /\band ask\b(?!\s+(yourself|the one question))|\bask:/i.test(withoutQuotes(l)) },
  /\bget (feedback|buy-in|user confirmation|approval)\b/i,
  /\bget (their|the person's|the user's) (agreement|approval|sign-off|confirmation)\b/i,
  /\buntil the person\b/i,
];

/** The line with its double-quoted spans removed. */
function withoutQuotes(line) {
  return line.replace(/"[^"]*"|“[^”]*”/g, '""');
}

const NAMES_PHASE = /CATALYST_PHASE/;
/** A guard: names CATALYST_PHASE and says not to ask or wait. Covers the rest of its section. */
const SAYS_NO_WAIT = /\b(never|do not|don't|skip)\b[^.]*\b(ask|wait)/i;
/** A wait line that names CATALYST_PHASE itself passes only if it also says what unattended mode
 *  does instead ("when set, wait for the user" still fails). */
const SAYS_UNATTENDED = /\b(never|do not|don't|skip|stop|proceed)\b/i;

/** findUnguardedWaits(text) → [{ line, text }] for every wait or ask line with no guard. */
export function findUnguardedWaits(text) {
  const problems = [];
  let guarded = false;
  let inFence = false;
  const lines = text.split("\n");
  lines.forEach((raw, index) => {
    if (/^\s*```/.test(raw)) inFence = !inFence;
    if (!inFence && /^##\s/.test(raw)) guarded = false;
    const isGuard = NAMES_PHASE.test(raw) && SAYS_NO_WAIT.test(raw);
    const isWait = !inFence && WAIT_OR_ASK.some((re) => re.test(raw));
    const selfGuarded = NAMES_PHASE.test(raw) && SAYS_UNATTENDED.test(raw);
    if (isWait && !guarded && !selfGuarded) {
      problems.push({ line: index + 1, text: raw.trim() });
    }
    if (isGuard) guarded = true;
  });
  return problems;
}

/** A wait or ask line that does not carry its own unattended rule: a place where a session that
 *  had not noticed the mode could stop. A line that states the rule itself is not one. */
function isPossibleWait(raw) {
  const isWait = WAIT_OR_ASK.some((re) => re.test(raw));
  return isWait && !(NAMES_PHASE.test(raw) && SAYS_UNATTENDED.test(raw));
}

/** A bash line that prints the mode when CATALYST_PHASE is set, so the session sees it. */
const MODE_ECHO = /CATALYST_PHASE[^\n]*\becho\b[^\n]*unattended/;

/** The problem with one SKILL.md's mode echo, or null: it must print the mode in a fenced block
 *  before the first possible wait (`isPossibleWait`). A skill with none anywhere needs no echo. */
function modeEchoProblem(text, hasWaitElsewhere = false) {
  const lines = text.split("\n");
  let inFence = false;
  let echoAt = -1;
  let firstWait = -1;
  lines.forEach((raw, index) => {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence && echoAt < 0 && MODE_ECHO.test(raw)) echoAt = index;
    if (!inFence && firstWait < 0 && isPossibleWait(raw)) firstWait = index;
  });
  if (firstWait < 0 && !hasWaitElsewhere) return null;
  if (echoAt < 0) return "no mode echo before its first possible wait";
  if (firstWait >= 0 && echoAt > firstWait) return "the mode echo comes after the first wait";
  return null;
}

/** modeEchoProblems(skillsDir) → [{ skill, problem }] for the phase skills. */
export function modeEchoProblems(skillsDir) {
  const problems = [];
  for (const name of PHASE_SKILLS) {
    const docs = skillDocuments(skillsDir, [name]);
    const [skillFile, ...refs] = docs;
    const hasWaitElsewhere = refs.some((f) =>
      readFileSync(f, "utf8").split("\n").some(isPossibleWait),
    );
    const problem = modeEchoProblem(readFileSync(skillFile, "utf8"), hasWaitElsewhere);
    if (problem !== null) problems.push({ skill: name, problem });
  }
  return problems;
}
/** The same rule over one text, for the test's positive controls. */
modeEchoProblems.forText = (text) => modeEchoProblem(text) ?? "";

/** skillDocuments(skillsDir, names) → the SKILL.md, references/*.md and assets/references/*.md
 *  paths of each named skill.
 *  A named skill with no SKILL.md throws: a renamed skill must not drop out of the check silently. */
export function skillDocuments(skillsDir, names = DISPATCHED_SKILLS) {
  const files = [];
  for (const name of names) {
    const skill = join(skillsDir, name, "SKILL.md");
    if (!existsSync(skill)) throw new Error(`unattended: no SKILL.md for dispatched skill "${name}"`);
    files.push(skill);
    // Its own references, and the shared references vendored into assets/references.
    for (const refs of [join(skillsDir, name, "references"), join(skillsDir, name, "assets", "references")]) {
      if (!existsSync(refs)) continue;
      for (const ref of readdirSync(refs).sort()) if (ref.endsWith(".md")) files.push(join(refs, ref));
    }
  }
  return files;
}

/** packProblems(skillsDir, names) → [{ file, line, text }] across the named skills. */
export function packProblems(skillsDir, names = DISPATCHED_SKILLS) {
  return skillDocuments(skillsDir, names).flatMap((file) =>
    findUnguardedWaits(readFileSync(file, "utf8")).map((p) => ({ file, ...p })),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const skillsDir = fileURLToPath(new URL("../skills", import.meta.url));
  const problems = packProblems(skillsDir);
  const echoes = modeEchoProblems(skillsDir);
  for (const p of problems) console.error(`unguarded wait: ${p.file}:${p.line}: ${p.text}`);
  for (const e of echoes) console.error(`mode echo: ${e.skill}: ${e.problem}`);
  if (problems.length > 0 || echoes.length > 0) {
    console.error(
      `unattended: ${problems.length} line(s) ask or wait with no CATALYST_PHASE guard in their section`,
    );
    process.exit(1);
  }
  console.log(
    "unattended: every ask or wait step is guarded by CATALYST_PHASE, and every phase skill prints the mode",
  );
}
