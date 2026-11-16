#!/usr/bin/env node
// run.mjs — run the unsticker skill on every case in evals.json and save one record per case.
//
// Run: node skills/unsticker/evals/run.mjs --out <dir> [--cases id,id] [--model sonnet]
//                                          [--skill-dir <dir>] [--with-checkout] [--jobs 4]
//
// Each case is one model call with no tools: the skill's files go in the system prompt, and the
// ask, the replica rows and the evidence snapshot are inlined in place of the files a triage
// container reads. `--with-checkout` also inlines the case's checkout block, the facts a run with
// a writable checkout of the branch would see. The model command is `claude -p` by default; set
// UNSTICKER_EVAL_CMD to another command that reads the prompt on stdin, takes the system prompt
// file as its last argument and prints the reply. Grade the output with grade.mjs.
//
// Writes <out>/<case-id>.json (the parsed record), <out>/<case-id>.raw.json (the reply and its
// cost) and <out>/run.json (the model, the skill directory, a hash of the skill's files, the number
// of calls and failures, and the cost), so a quoted score can be traced to what produced it.
// A call whose model command fails (the command reports is_error, exits non-zero or cannot start)
// writes no record and prints `error <case-id>: <message>`; a record an earlier run left in <out>
// for that case is removed. The run exits 0 when every call worked, 1 when some failed and 3 when
// all did, so a model that never answered cannot be read as a score of zero.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));

function opt(args, name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
}

export function skillText(skillDir) {
  const parts = [["SKILL.md", readFileSync(join(skillDir, "SKILL.md"), "utf8")]];
  const refs = join(skillDir, "references");
  for (const f of readdirSync(refs).filter((f) => f.endsWith(".md")).sort()) parts.push([`references/${f}`, readFileSync(join(refs, f), "utf8")]);
  return parts.map(([name, text]) => `=== file: ${name} ===\n${text}`).join("\n\n");
}

/** The grading fields, asked for identically whatever the skill version says. */
export function harnessNote(steps) {
  const vocab = Object.entries(steps).map(([k, v]) => `  - ${k}: ${v}`).join("\n");
  return [
    "This run is graded. Whatever the skill's record shape says, the record must also carry these fields:",
    "- `next_steps`: an ordered array of the steps that move the work, each one of:",
    vocab,
    "- `ask_option`: the letter of the ask's listed option those steps amount to, or null when no listed option fits.",
    "- `reaches_human`: true when the ask must stay with a person, false when an agent or the platform can carry the steps.",
    "- `stale_evidence`: an array of { field, said, newer, source } for each input that a newer input contradicts (empty when none).",
    "- `round_table`: for an ask about repair rounds, one { round, changed_code, cause, evidence } per counted round you can see, `cause` one of platform, base, code, unknown; otherwise [].",
  ].join("\n");
}

export function casePrompt(c, steps, withCheckout) {
  const { ask, subjects, snapshot, checkout } = c.inputs;
  const blocks = [
    `Triage ask ${ask.identifier}. CATALYST_PHASE=triage. You have no tools in this run: the replica rows and the evidence snapshot are inlined below in place of the files. Follow the skill's container path on them and reply with the ask-triage/v1 record as the last thing in your reply, as one JSON object.`,
    `## Replica rows ($CATALYST_REPLICA_DB)\n\n### The ask\n\`\`\`json\n${JSON.stringify(ask, null, 2)}\n\`\`\`\n\n### Subject tickets\n\`\`\`json\n${JSON.stringify(subjects, null, 2)}\n\`\`\``,
    `## Evidence snapshot ($CATALYST_TRIAGE_SNAPSHOT)\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\``,
  ];
  if (withCheckout && checkout) blocks.push(`## Checkout (a writable checkout of the ticket's branch and origin/main, read only in this run)\n\`\`\`json\n${JSON.stringify(checkout, null, 2)}\n\`\`\``);
  blocks.push(harnessNote(steps));
  return blocks.join("\n\n");
}

/** The last top-level JSON object in a reply that carries a `classification`. */
export function extractRecord(text) {
  const s = String(text);
  // The end of the balanced object starting at `start`, skipping braces inside strings; -1 if none.
  const close = (start) => {
    let depth = 0;
    let inString = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return i;
    }
    return -1;
  };
  let found = null;
  for (let start = s.indexOf("{"); start >= 0; ) {
    const end = close(start);
    if (end < 0) break;
    try {
      const obj = JSON.parse(s.slice(start, end + 1));
      if (obj && typeof obj === "object" && "classification" in obj) found = obj;
      start = s.indexOf("{", end + 1);
    } catch {
      start = s.indexOf("{", start + 1);
    }
  }
  return found;
}

function runModel({ prompt, systemFile, model }) {
  const custom = process.env.UNSTICKER_EVAL_CMD;
  const [cmd, ...argv] = custom
    ? [...custom.split(" "), systemFile]
    : ["claude", "-p", "--model", model, "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--setting-sources", "", "--output-format", "json", "--system-prompt-file", systemFile];
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd: tmpdir(), env: { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ code: -1, out, err: `${err}${e.message}` }));
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.on("error", () => {
      /* the command exited before reading the prompt; its exit code says why */
    });
    child.stdin.end(prompt);
  });
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || !args.includes("--out")) {
    console.log("usage: node run.mjs --out <dir> [--cases id,id] [--model sonnet] [--skill-dir <dir>] [--with-checkout] [--jobs 4]");
    return args.includes("--help") ? 0 : 2;
  }
  const out = opt(args, "--out");
  const model = opt(args, "--model", "sonnet");
  const skillDir = opt(args, "--skill-dir", join(here, ".."));
  const jobs = Number(opt(args, "--jobs", "4"));
  const withCheckout = args.includes("--with-checkout");
  const evals = JSON.parse(readFileSync(opt(args, "--evals", join(here, "evals.json")), "utf8"));
  const only = opt(args, "--cases");
  const cases = only ? evals.cases.filter((c) => only.split(",").includes(c.id)) : evals.cases;
  mkdirSync(out, { recursive: true });
  const systemFile = join(out, "system-prompt.md");
  writeFileSync(systemFile, `You are running the \`unsticker\` skill. Its files follow.\n\n${skillText(skillDir)}`);

  let cost = 0;
  let calls = 0;
  let errors = 0;
  const queue = [...cases];
  async function worker() {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const res = await runModel({ prompt: casePrompt(c, evals.steps, withCheckout), systemFile, model });
      calls++;
      let reply = res.out;
      let usd = null;
      let reported = null;
      try {
        const j = JSON.parse(res.out);
        reply = j.result ?? res.out;
        usd = j.total_cost_usd ?? null;
        if (j.is_error === true) reported = String(j.result ?? "the model command reported an error");
      } catch {
        /* a custom command printing plain text */
      }
      if (typeof usd === "number") cost += usd;
      // A failed call is an error, never a record: a model that did not answer has not been measured.
      const failure = reported ?? (res.code === 0 ? null : res.err.trim() || String(res.out).trim() || `the model command exited ${res.code}`);
      const record = failure === null ? extractRecord(reply) : null;
      writeFileSync(join(out, `${c.id}.raw.json`), JSON.stringify({ code: res.code, usd, reply, stderr: res.err.slice(0, 2000) }, null, 2));
      rmSync(join(out, `${c.id}.json`), { force: true });
      if (record) writeFileSync(join(out, `${c.id}.json`), JSON.stringify(record, null, 2));
      if (failure !== null) {
        errors++;
        console.log(`error ${c.id}: ${failure.replace(/\s+/g, " ").slice(0, 200)}`);
      } else {
        console.log(`${record ? "ok  " : "none"} ${c.id}${usd != null ? ` $${usd.toFixed(3)}` : ""}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
  const skillSha256 = createHash("sha256").update(skillText(skillDir)).digest("hex");
  const meta = { model, skillDir: resolvePath(skillDir), skillSha256, cases: calls, errors, costUsd: Number(cost.toFixed(6)) };
  writeFileSync(join(out, "run.json"), JSON.stringify(meta, null, 2));
  console.log(`\n${calls} calls on ${model}, ${errors} failed, reported cost $${cost.toFixed(2)}`);
  return errors === 0 ? 0 : errors === calls ? 3 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv).then((code) => process.exit(code));
