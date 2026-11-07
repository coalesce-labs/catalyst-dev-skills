// The record of what the repository's check really did. `stage check` runs it and writes the record;
// `stage done implement` reads the record, never the session's account of it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, baseRef, noBaseMessage } from "./lib.mjs";

const RUN = /^(.*\s)?(?:bun|npm|pnpm|yarn) run ([\w:.@/-]+)$/;
const NOT_SPLITTABLE = /[|;()`$<>'"\\]/;
const COLOUR = /\x1b\[[0-9;]*m/g;

/** One step per link of an `a && b` chain, through named scripts, so a red link does not hide the links after it. */
export function expandCheck(command, scripts, depth = 0) {
  const segment = command.trim();
  const match = RUN.exec(segment);
  const body = match ? scripts[match[2]] : undefined;
  if (typeof body !== "string" || depth > 8 || NOT_SPLITTABLE.test(body)) return [segment];
  if (!body.includes("&&") && !RUN.test(body.trim())) return [segment];
  const prefix = match[1] ?? "";
  return body.split(/\s*&&\s*/).flatMap((part) => expandCheck(`${prefix}${prefix && /^\w+=/.test(part) ? "env " : ""}${part}`, scripts, depth + 1));
}

/** Failing test names and type errors a log states. An empty list means none could be read, never that none failed. */
export function failuresIn(text) {
  const names = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(COLOUR, "");
    if (/\(pass\)|✓/.test(line)) continue;
    const found = /\(fail\) (.+?)(?: \[[\d.]+m?s\])?\s*$/.exec(line) ?? /\bFAIL\s+(\S+\.(?:test|spec)\.\S+.*)$/.exec(line) ?? /(\S+\(\d+,\d+\): error TS\d+.*)$/.exec(line);
    if (found) names.add(found[1].trim().slice(0, 240));
  }
  return [...names].sort();
}

function git(cwd, args, env = process.env) {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${(result.stderr ?? "").trim().slice(0, 300)}`);
  return result.stdout.trim();
}

/** The tree as it stands, commit or no commit, leaving the real index alone. `thoughts/` is not part of the change. */
export function treeId(cwd) {
  const folder = mkdtempSync(join(tmpdir(), "stage-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(folder, "index") };
  try {
    git(cwd, ["read-tree", "HEAD"], env);
    // Naming an ignored path in a pathspec, even to exclude it, makes `git add` fail. Add everything,
    // then take thoughts/ back out in case this repository does not ignore it.
    git(cwd, ["add", "-A", "--", "."], env);
    git(cwd, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", "thoughts"], env);
    return git(cwd, ["write-tree"], env);
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

/** The skills these scripts belong to, as one hash of every file under the skills folder. A stage
 * records it at start and every check record carries it; a change during a stage voids the stage's
 * evidence, because the scripts that produce the evidence are what changed. */
export function toolsHash() {
  const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "../.."));
  const hash = createHash("sha256");
  const walk = (folder) => {
    for (const name of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, name.name);
      if (name.isDirectory()) walk(path);
      else if (name.isFile()) hash.update(relative(root, path)).update("\0").update(readFileSync(path)).update("\0");
    }
  };
  walk(root);
  return { dir: root, hash: hash.digest("hex").slice(0, 16) };
}

export function checkCommand(cwd) {
  if (process.env.CATALYST_CHECK_COMMAND) return process.env.CATALYST_CHECK_COMMAND;
  const path = join(cwd, "package.json");
  if (existsSync(path) && JSON.parse(readFileSync(path, "utf8")).scripts?.check) return "bun run check";
  throw new Error("no check command: set CATALYST_CHECK_COMMAND to the command the repository's AGENTS.md or CI names");
}

function runOnce(step, cwd, log) {
  const descriptor = openSync(log, "w");
  const started = Date.now();
  const result = spawnSync("bash", ["-c", step], { cwd, stdio: ["ignore", descriptor, descriptor], env: process.env });
  closeSync(descriptor);
  const text = readFileSync(log);
  return { exit: result.status ?? 128, failures: failuresIn(text.toString("utf8")), seconds: Math.round((Date.now() - started) / 1000), log, log_sha256: createHash("sha256").update(text).digest("hex") };
}

/** Runs every step and retries a red one once. Green on the retry is recorded as flaky and is not red. */
export function runSteps(steps, cwd, logDir, label, say = () => {}) {
  mkdirSync(logDir, { recursive: true });
  return steps.map((step, index) => {
    const log = join(logDir, `${label}-${String(index).padStart(2, "0")}`);
    const first = runOnce(step, cwd, `${log}.log`);
    if (first.exit === 0) { say(`ok    ${step}`); return { step, ...first }; }
    const retry = runOnce(step, cwd, `${log}.retry.log`);
    if (retry.exit === 0) { say(`flaky ${step}`); return { step, ...retry, flaky: first.failures, first_exit: first.exit }; }
    const both = first.failures.filter((name) => retry.failures.includes(name));
    say(`RED   ${step}`);
    return { step, ...retry, first_exit: first.exit, failures: both.length ? both : [...new Set([...first.failures, ...retry.failures])], all_failures: [...new Set([...first.failures, ...retry.failures])] };
  });
}

function installAt(cwd) {
  const command = existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb")) ? "bun install --frozen-lockfile"
    : existsSync(join(cwd, "pnpm-lock.yaml")) ? "pnpm install --frozen-lockfile"
    : existsSync(join(cwd, "yarn.lock")) ? "yarn install --frozen-lockfile"
    : existsSync(join(cwd, "package-lock.json")) ? "npm ci" : null;
  if (!command) return;
  const result = spawnSync("bash", ["-c", command], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`could not install at base: ${(result.stderr ?? "").slice(-300)}`);
}

const headPath = (dir, tree) => join(dir, "checks", `head-${tree}.json`);
const basePath = (dir, tree) => join(dir, "checks", `base-${tree}.json`);

/** `stage check`: the whole check on the tree as it stands. */
export function recordHead(dir, cwd, say) {
  const command = checkCommand(cwd);
  const scripts = existsSync(join(cwd, "package.json")) ? JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).scripts ?? {} : {};
  const before = treeId(cwd);
  const steps = runSteps(expandCheck(command, scripts), cwd, join(dir, "checks", "logs", before), "head", say);
  const tree = treeId(cwd);
  const record = { tree, tree_before: before, head: git(cwd, ["rev-parse", "HEAD"]), command, at: new Date().toISOString(), tools: toolsHash(), steps };
  atomicWrite(headPath(dir, tree), JSON.stringify(record, null, 2) + "\n");
  return record;
}

/** `stage check --base`: each step red on this tree, rerun from a clean copy of the base. */
export function recordBase(dir, cwd, say) {
  const tree = treeId(cwd);
  if (!existsSync(headPath(dir, tree))) throw new Error("no check record for this tree: run `stage check` first");
  const red = JSON.parse(readFileSync(headPath(dir, tree), "utf8")).steps.filter((step) => step.exit !== 0);
  const ref = baseRef(cwd);
  const forkPoint = spawnSync("git", ["merge-base", ref, "HEAD"], { cwd, encoding: "utf8" });
  if (forkPoint.status !== 0) throw new Error(noBaseMessage(ref, "HEAD"));
  const base = forkPoint.stdout.trim();
  const copy = mkdtempSync(join(dir, "checks-base-"));
  try {
    git(cwd, ["worktree", "add", "-q", "--detach", copy, base]);
    if (existsSync(join(cwd, "thoughts"))) symlinkSync(realpathSync(join(cwd, "thoughts")), join(copy, "thoughts"));
    installAt(copy);
    const steps = runSteps(red.map((step) => step.step), copy, join(dir, "checks", "logs", tree), "base", say);
    const record = { tree, base, ref, at: new Date().toISOString(), tools: toolsHash(), steps };
    atomicWrite(basePath(dir, tree), JSON.stringify(record, null, 2) + "\n");
    return record;
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", copy], { cwd });
    rmSync(copy, { recursive: true, force: true });
  }
}

/** Green, or every failing test also fails at base. Anything else is not proven and stops the stage. */
export function checkVerdict(head, base) {
  const flaky = head.steps.filter((step) => step.flaky).map((step) => ({ step: step.step, failures: step.flaky }));
  const red = head.steps.filter((step) => step.exit !== 0);
  const notOurs = [], unproven = [];
  for (const step of red) {
    const atBase = base?.steps.find((row) => row.step === step.step);
    if (!atBase) { unproven.push({ step: step.step, reason: "not run at base", failures: step.failures }); continue; }
    if (atBase.exit === 0) { unproven.push({ step: step.step, reason: "green at base, so this change may have caused it", failures: step.failures }); continue; }
    if (!step.failures.length) { unproven.push({ step: step.step, reason: "red with no failing test named in its log", failures: [] }); continue; }
    const failedAtBase = atBase.all_failures ?? atBase.failures;
    const extra = step.failures.filter((name) => !failedAtBase.includes(name));
    if (extra.length) unproven.push({ step: step.step, reason: "these tests did not fail at base", failures: extra });
    else notOurs.push({ step: step.step, failures: step.failures });
  }
  return { ok: unproven.length === 0, green: red.length === 0, flaky, not_ours: notOurs, unproven, ran: head.steps.length };
}

/** What `stage done implement` holds this tree to. Throws with the exact next command. */
export function requireProvenCheck(dir, cwd) {
  const tree = treeId(cwd);
  if (!existsSync(headPath(dir, tree))) throw new Error("no check record for this exact tree: run `stage check` (start it in the background; it can take an hour), then `stage done implement`");
  const head = JSON.parse(readFileSync(headPath(dir, tree), "utf8"));
  const base = existsSync(basePath(dir, tree)) ? JSON.parse(readFileSync(basePath(dir, tree), "utf8")) : null;
  const tools = toolsHash();
  for (const [name, record] of [["check", head], ["base check", base]]) {
    if (record && record.tools?.hash !== tools.hash) throw new Error(`the ${name} record was written by different stage scripts (${record.tools?.hash ?? "none recorded"}, now ${tools.hash}). Restore the skills as shipped and run \`stage check\` again. If a stage script is wrong, stop with \`stage fail <stage> --class environment --reason "<the bug>"\` instead of changing it.`);
  }
  const verdict = checkVerdict(head, base);
  if (!verdict.ok) {
    const lines = verdict.unproven.map((row) => `${row.step}: ${row.reason}${row.failures.length ? ` (${row.failures.join("; ")})` : ""}`);
    throw new Error(`the check is red and not proven unrelated:\n${lines.join("\n")}\n${base ? "Fix these and run `stage check` again, or stop with `stage fail implement --class environment` and this list." : "Fix them and run `stage check` again, or run `stage check --base` if this change did not cause them."}`);
  }
  return { ...verdict, tree, head: head.head, command: head.command };
}

const BLOCK = "<!-- stage-check-result -->";
/** The pull request's check section comes from the record. A retry replaces it. */
export function appendCheckResult(prPath, dir, cwd) {
  const verdict = requireProvenCheck(dir, cwd);
  const lines = [BLOCK, "## Check result", "", `Recorded by the stage script, not the session: \`${verdict.command}\`, ${verdict.ran} steps run.`, ""];
  lines.push(verdict.green ? "All steps green." : "**Red, and not caused by this change.** Each test below fails the same way on the base without it:");
  for (const row of verdict.not_ours) { lines.push(`- \`${row.step}\``); for (const name of row.failures) lines.push(`  - ${name}`); }
  if (verdict.flaky.length) { lines.push("", "Red once and green on the retry:"); for (const row of verdict.flaky) lines.push(`- \`${row.step}\`${row.failures.length ? `: ${row.failures.join("; ")}` : ""}`); }
  const current = readFileSync(prPath, "utf8");
  const kept = current.includes(BLOCK) ? current.slice(0, current.indexOf(BLOCK)).trimEnd() : current.trimEnd();
  atomicWrite(prPath, `${kept}\n\n${lines.join("\n")}\n`);
}
