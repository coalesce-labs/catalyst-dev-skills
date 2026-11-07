// One review step in a session of its own, with the skill's whole text in the prompt, so reading it
// is not left to the agent. The verdict is read from the session's report, not from a later claim.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite } from "./lib.mjs";

const SKILLS = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "../.."));
export const REVIEW_STEPS = {
  "review-code": { step: "code-review", skills: ["review-code"], scope: true },
  "review-security": { step: "security-review", skills: ["review-security"], scope: true },
  "validate-type-safety": { step: "type-safety", skills: ["validate-type-safety", "scan-reward-hacking"], scope: false },
};
export const STEP_SKILL = Object.fromEntries(Object.entries(REVIEW_STEPS).map(([skill, item]) => [item.step, skill]));

const git = (cwd, args) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.trim()}`);
  return result.stdout.trim();
};
export const receiptPath = (dir, skill, head) => join(dir, "reviews", `${skill}-${head}.json`);

function skillFiles(skill) {
  const root = join(SKILLS, skill);
  const files = [join(root, "SKILL.md")];
  for (const folder of ["references", "assets/references"]) {
    const path = join(root, folder);
    if (existsSync(path)) for (const name of readdirSync(path).sort()) if (name.endsWith(".md")) files.push(join(path, name));
  }
  return files;
}

export function composePrompt(skill, base, head, scope = "") {
  const { step, skills } = REVIEW_STEPS[skill];
  const files = skills.flatMap(skillFiles);
  const body = files.map((path) => {
    const owner = relative(SKILLS, path).split("/")[0];
    const text = readFileSync(path, "utf8").replaceAll("${CLAUDE_SKILL_DIR}", join(SKILLS, owner)).replaceAll("$ARGUMENTS", `--base ${base}`);
    return `<file path="${relative(SKILLS, path)}">\n${text}\n</file>`;
  }).join("\n\n");
  const prompt = `You are running one review step of a ticket's workflow: ${step}, on base ${base} and head ${head}.

Follow the skill below in full, on that base and head. Its reference files are included, so you need not open them. Read and report only: change no file, and do not commit or push.
${scope ? `\nIts scope step already ran, so use this output and do not run it again:\n\n${scope}\n` : ""}
End your final message with the step's verdict, as a fenced block tagged catalyst-review-step holding one line of JSON:
{"step":"${step}","verdict":"PASS or FAIL or PARTIAL or SKIPPED","detail":"one sentence"}

${body}
`;
  return { prompt, files: files.map((path) => relative(SKILLS, path)) };
}

// A failing session often says why on stdout, and stderr may hold only a warning.
function sessionError(result, stdout) {
  let said = (stdout ?? "").trim();
  try { said = String(JSON.parse(said).result ?? said); } catch { /* not JSON: keep the text */ }
  const hint = /not logged in/i.test(said) ? " A login held in an environment variable does not reach the commands a session runs. Set CATALYST_REVIEW_SESSION_CMD to a command that signs in, or run stage fail review --class environment." : "";
  return new Error(`the review session failed (exit ${result.status}): ${said.slice(-400)} ${(result.stderr ?? "").trim().slice(-400)}`.trim() + hint);
}

// The skill's first step, run here so its result never depends on the session.
function runScope(dir, skill, base, cwd) {
  const result = spawnSync("bash", [join(SKILLS, skill, "scripts/review-scope.sh"), "--base", base], { cwd, encoding: "utf8", env: { ...process.env, CATALYST_ARTIFACT_DIR: dir } });
  if (result.status !== 0 && result.status !== 3) throw new Error(`the ${skill} scope step could not run (exit ${result.status}): ${(result.stdout + result.stderr).trim().slice(-400)}`);
  return { nothing: result.status === 3, output: result.stdout.trim() };
}

// A command that reads the prompt on stdin and prints the final report. With none named, Claude Code.
function runSession(prompt, cwd) {
  const timeout = Number(process.env.CATALYST_REVIEW_TIMEOUT_SECONDS ?? 1800) * 1000;
  const env = { ...process.env, CATALYST_STAGE: "validate" };
  const command = process.env.CATALYST_REVIEW_SESSION_CMD;
  const options = { cwd, env, input: prompt, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 };
  if (command) {
    const result = spawnSync("bash", ["-c", command], options);
    if (result.status !== 0) throw sessionError(result, result.stdout);
    return { report: result.stdout, usd: null };
  }
  delete env.CLAUDECODE;
  const model = process.env.CATALYST_REVIEW_MODEL;
  const result = spawnSync("claude", ["-p", "--output-format", "json", "--allowedTools", "Bash,Read,Grep,Glob", ...(model ? ["--model", model] : [])], options);
  if (result.error?.code === "ENOENT") throw new Error("no way to start a review session: install the claude command or set CATALYST_REVIEW_SESSION_CMD, or run stage fail review --class environment");
  if (result.status !== 0) throw sessionError(result, result.stdout);
  const output = JSON.parse(result.stdout);
  if (output.is_error) throw new Error(`the review session failed: ${String(output.result).slice(0, 400)}`);
  return { report: output.result ?? "", usd: output.total_cost_usd ?? null };
}

export function parseVerdict(report, step) {
  const blocks = [...report.matchAll(/```catalyst-review-step\s*\n([\s\S]*?)\n\s*```/g)];
  if (!blocks.length) throw new Error(`the ${step} session ended with no catalyst-review-step block`);
  let parsed;
  try { parsed = JSON.parse(blocks.at(-1)[1]); } catch { throw new Error(`the ${step} session's catalyst-review-step block is not valid JSON`); }
  if (parsed.step !== step) throw new Error(`the session reported step ${parsed.step}, expected ${step}`);
  if (!["PASS", "FAIL", "PARTIAL", "SKIPPED"].includes(parsed.verdict)) throw new Error(`the ${step} session reported verdict ${parsed.verdict}`);
  return parsed;
}

export function runReviewStep(dir, skill, baseInput, cwd, tools) {
  const item = REVIEW_STEPS[skill];
  if (!item) throw new Error(`review-step takes ${Object.keys(REVIEW_STEPS).join(", ")}`);
  if (!baseInput) throw new Error("review-step requires --base <ref>");
  const base = git(cwd, ["rev-parse", baseInput]);
  const head = git(cwd, ["rev-parse", "HEAD"]);
  const before = git(cwd, ["status", "--porcelain"]);
  const scope = item.scope ? runScope(dir, skill, base, cwd) : null;
  const write = (verdict, report, prompt, files, usd) => {
    const reportPath = join(dir, "reviews", `${skill}-${head}.md`);
    atomicWrite(reportPath, report.endsWith("\n") ? report : `${report}\n`);
    const receipt = { skill, step: item.step, base, head, verdict: verdict.verdict, detail: verdict.detail ?? "", files, prompt_sha256: createHash("sha256").update(prompt).digest("hex"), usd, tools, at: new Date().toISOString() };
    atomicWrite(receiptPath(dir, skill, head), JSON.stringify(receipt, null, 2) + "\n");
    return { ...receipt, report: reportPath };
  };
  if (scope?.nothing) return write({ verdict: "SKIPPED", detail: "its scope step found nothing to review" }, scope.output, "", [], 0);
  const { prompt, files } = composePrompt(skill, base, head, scope?.output);
  const { report, usd } = runSession(prompt, cwd);
  atomicWrite(join(dir, "reviews", `${skill}-${head}.last-session.md`), report);
  if (git(cwd, ["rev-parse", "HEAD"]) !== head || git(cwd, ["status", "--porcelain"]) !== before) {
    throw new Error(`the ${item.step} session changed the checkout, and a review step only reports. Restore it and run the step again.`);
  }
  return write(parseVerdict(report, item.step), report, prompt, files, usd);
}

// Every gate that claims a verdict needs the session that produced it. Returns one line per problem.
export function reviewGateProblems(dir, result, cwd, { provenCheck }) {
  const problems = [];
  const touchesTypes = () => git(cwd, ["diff", "--name-only", result.base, result.final_head]).split("\n").some((path) => /\.tsx?$|(^|\/)tsconfig[^/]*\.json$/.test(path));
  const receiptFor = (skill, head) => {
    try { return JSON.parse(readFileSync(receiptPath(dir, skill, head), "utf8")); } catch { return null; }
  };
  const fixed = result.final_head !== result.reviewed_head;
  for (const gate of result.gates ?? []) {
    if (!gate) continue;
    const skill = STEP_SKILL[gate.step];
    if (gate.verdict === "SKIPPED") {
      if (gate.step === "security-review" && result.depth === "deep") problems.push("security-review is SKIPPED, and a deep review always runs it");
      if (gate.step === "type-safety" && touchesTypes()) problems.push("type-safety is SKIPPED, and the diff touches TypeScript");
      if (gate.step === "code-review") {
        const scope = spawnSync("bash", [join(SKILLS, "review-code/scripts/review-scope.sh"), "--base", result.base], { cwd, encoding: "utf8", env: { ...process.env, CATALYST_ARTIFACT_DIR: dir } });
        if (scope.status === 0) problems.push("code-review is SKIPPED, and the diff has code to review");
      }
      continue;
    }
    if (gate.step === "recheck") {
      if (!fixed) continue;
      const seen = receiptFor("review-code", result.final_head);
      if (!seen || seen.base !== result.reviewed_head) problems.push(`recheck is ${gate.verdict} with no review-code session on the fix range ${result.reviewed_head}..${result.final_head}. Run stage review-step review-code --base ${result.reviewed_head}`);
      continue;
    }
    if (!skill) continue;
    const seen = receiptFor(skill, result.reviewed_head);
    if (!seen) problems.push(`${gate.step} is ${gate.verdict} but ${skill} never ran in its own session at ${result.reviewed_head}. Run stage review-step ${skill} --base ${result.base}, or set the verdict to SKIPPED with the reason`);
    else if (seen.base !== result.base) problems.push(`${gate.step}: ${skill} ran against base ${seen.base}, the review names ${result.base}`);
    else if (seen.verdict !== gate.verdict) problems.push(`${gate.step} says ${gate.verdict}, and its session reported ${seen.verdict}`);
    if (gate.step === "type-safety" && gate.verdict !== "FAIL") {
      try { provenCheck(); } catch (error) { problems.push(`type-safety is ${gate.verdict} but the full check is not recorded green for this tree: ${error.message.split("\n")[0]}`); }
    }
  }
  if (fixed && !(result.gates ?? []).some((gate) => gate?.step === "recheck")) problems.push("the review committed fixes and records no recheck gate");
  return problems;
}
