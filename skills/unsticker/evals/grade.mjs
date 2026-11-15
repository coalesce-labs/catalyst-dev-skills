#!/usr/bin/env node
// grade.mjs — score unsticker records against the cases in evals.json. No model, no network.
//
// Run: node skills/unsticker/evals/grade.mjs <records-dir> [--evals <file>] [--bar 0.9] [--json]
//
// <records-dir> holds one <case-id>.json per case: the ask-triage/v1 record the run wrote. A
// missing or unparseable record fails its case. Exit 0 when the recommendation score reaches the
// bar and every stale-evidence expectation is met, 1 otherwise, 2 on bad usage.
//
// Each case is graded on two halves, as the eval asks:
//   recommendation: classification, next steps, the ask option, whether it reaches a person,
//                   named specifics, and (for rounds that changed nothing) the round table;
//   stale evidence: every stale field the case plants is named in stale_evidence[].field.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function loadEvals(file = join(here, "evals.json")) {
  return JSON.parse(readFileSync(file, "utf8"));
}

const lower = (v) => String(v ?? "").toLowerCase();

/** The option letter a record picked: `ask_option`, else the proposed answer's leading letter. */
export function optionOf(record) {
  if (record == null) return undefined;
  if (Object.hasOwn(record, "ask_option")) {
    const v = record.ask_option;
    if (v === null || v === "" || v === "none") return null;
    const m = /^\s*([A-Z])\b/.exec(String(v));
    return m ? m[1] : null;
  }
  const label = record.proposed_answer?.option_label;
  if (label) {
    const m = /^\s*([A-Z])\b/.exec(String(label));
    if (m) return m[1];
  }
  return undefined;
}

/** gradeCase(caseDef, record) → { id, recommendation, stale, pass, failures[] } */
export function gradeCase(caseDef, record) {
  const e = caseDef.expected;
  const failures = [];
  if (record == null || typeof record !== "object") {
    return { id: caseDef.id, recommendation: false, stale: (e.stale ?? []).length === 0 ? true : false, pass: false, failures: ["no record"] };
  }
  const steps = Array.isArray(record.next_steps) ? record.next_steps.map(String) : [];
  const vocab = new Set(Object.keys(loadEvals().steps));
  for (const s of steps) if (!vocab.has(s)) failures.push(`unknown step "${s}"`);

  if (!e.classification.includes(record.classification)) failures.push(`classification ${record.classification} not in [${e.classification}]`);
  for (const group of e.steps_all ?? []) {
    if (!group.some((s) => steps.includes(s))) failures.push(`next_steps lacks one of [${group}]`);
  }
  for (const s of e.steps_none ?? []) if (steps.includes(s)) failures.push(`next_steps includes forbidden "${s}"`);
  if (Array.isArray(e.option)) {
    const got = optionOf(record);
    if (!e.option.includes(got === undefined ? null : got)) failures.push(`ask_option ${JSON.stringify(got ?? null)} not in ${JSON.stringify(e.option)}`);
  }
  if (typeof e.reaches_human === "boolean" && record.reaches_human !== e.reaches_human) {
    failures.push(`reaches_human ${record.reaches_human} != ${e.reaches_human}`);
  }
  const text = lower(JSON.stringify(record));
  for (const group of e.detail_any ?? []) {
    if (!group.some((k) => text.includes(lower(k)))) failures.push(`record never mentions one of [${group}]`);
  }
  if (e.no_code_rounds) {
    const rows = Array.isArray(record.round_table) ? record.round_table : [];
    if (rows.length === 0) failures.push("round_table is empty");
    else if (rows.some((r) => r.changed_code === true)) failures.push("round_table claims a round changed code");
    if (!rows.some((r) => lower(r.cause) === "platform")) failures.push("round_table names no platform cause");
  }
  const recommendation = failures.length === 0;

  const staleFields = (Array.isArray(record.stale_evidence) ? record.stale_evidence : []).map((s) => lower(`${s.field ?? ""} ${s.said ?? ""}`));
  const staleMisses = [];
  for (const group of e.stale ?? []) {
    if (!staleFields.some((f) => group.some((k) => f.includes(lower(k))))) staleMisses.push(`stale_evidence never names [${group}]`);
  }
  const stale = staleMisses.length === 0;
  return { id: caseDef.id, recommendation, stale, pass: recommendation && stale, failures: [...failures, ...staleMisses] };
}

export function readRecord(dir, id) {
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function gradeAll(evals, dir) {
  const results = evals.cases.map((c) => gradeCase(c, readRecord(dir, c.id)));
  const n = results.length;
  const rec = results.filter((r) => r.recommendation).length;
  const staleCases = evals.cases.filter((c) => (c.expected.stale ?? []).length > 0).map((c) => c.id);
  const staleMet = results.filter((r) => staleCases.includes(r.id) && r.stale).length;
  return { results, n, recommendationScore: n ? rec / n : 0, staleCases: staleCases.length, staleMet };
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    console.log("usage: node grade.mjs <records-dir> [--evals <file>] [--bar 0.9] [--json]");
    return args.includes("--help") ? 0 : 2;
  }
  const opt = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const dir = args[0];
  const evals = loadEvals(opt("--evals", join(here, "evals.json")));
  const bar = Number(opt("--bar", "0.9"));
  const g = gradeAll(evals, dir);
  if (args.includes("--json")) {
    console.log(JSON.stringify(g, null, 2));
  } else {
    for (const r of g.results) {
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}${r.failures.length ? `\n      ${r.failures.join("\n      ")}` : ""}`);
    }
    console.log(`\nrecommendation: ${g.results.filter((r) => r.recommendation).length}/${g.n} (${(g.recommendationScore * 100).toFixed(0)}%), bar ${bar * 100}%`);
    console.log(`stale evidence named: ${g.staleMet}/${g.staleCases} cases`);
  }
  return g.recommendationScore >= bar && g.staleMet === g.staleCases ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv));
