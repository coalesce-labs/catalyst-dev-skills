// unsticker-evals.test.mjs — the unsticker's eval set is well formed, public, and graded the way
// the skill's record describes. CTC-10631.
//
// Run: bun test tests/unsticker-evals.test.mjs
//
// The cases come from real stuck asks, anonymized. This file holds them to the published pack's
// rules (no real ticket ids, people or private repositories), checks that every expectation uses
// the record's closed step vocabulary, and proves the grader: a record built from a case's own
// expectation passes, and each kind of wrong answer fails.

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { RULES } from "../scripts/check-public-prose.mjs";
import { gradeCase, optionOf } from "../skills/unsticker/evals/grade.mjs";
import { extractRecord, casePrompt } from "../skills/unsticker/evals/run.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(`${root}${rel}`, "utf8");
const evals = JSON.parse(read("skills/unsticker/evals/evals.json"));
const steps = Object.keys(evals.steps);

/** A record that meets a case's expectation exactly. */
function passing(c) {
  const e = c.expected;
  const stepList = (e.steps_all ?? []).map((g) => g[0]);
  return {
    schema: "ask-triage/v1",
    classification: e.classification[0],
    next_steps: stepList,
    ask_option: Array.isArray(e.option) ? e.option[0] : null,
    reaches_human: typeof e.reaches_human === "boolean" ? e.reaches_human : false,
    stale_evidence: (e.stale ?? []).map((g) => ({ field: g[0], said: "", newer: "", source: "" })),
    round_table: e.no_code_rounds ? [{ round: 1, changed_code: false, cause: "platform", evidence: "x" }] : [],
    notes: (e.detail_any ?? []).map((g) => g[0]).join(" "),
  };
}

describe("the eval set is well formed", () => {
  test("it has at least twenty cases with unique ids", () => {
    const ids = evals.cases.map((c) => c.id);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every case carries the ask, the subjects, the snapshot and an expectation", () => {
    for (const c of evals.cases) {
      expect(c.inputs.ask.identifier).toMatch(/^ENG-\d+$/);
      expect(Array.isArray(c.inputs.subjects)).toBe(true);
      expect(typeof c.inputs.snapshot.capturedAtMs).toBe("number");
      expect(c.expected.classification.length).toBeGreaterThan(0);
      expect(["high", "medium"]).toContain(c.answer_confidence);
    }
  });

  test("every expected step is in the record's closed vocabulary", () => {
    for (const c of evals.cases) {
      for (const s of [...(c.expected.steps_all ?? []).flat(), ...(c.expected.steps_none ?? [])]) expect(steps).toContain(s);
    }
  });

  test("record.md documents the same step vocabulary the grader reads", () => {
    const record = read("skills/unsticker/references/record.md");
    for (const s of steps) expect(record).toContain(`\`${s}\``);
    for (const field of ["next_steps", "ask_option", "reaches_human", "stale_evidence", "round_table"]) expect(record).toContain(`\`${field}\``);
  });
});

describe("the eval set is publishable", () => {
  const text = read("skills/unsticker/evals/evals.json");
  const banned = RULES.filter((r) => ["plugin-prefix", "named-person", "ticket-id", "private-reference", "ai-subscription", "setup-token", "plan-tier"].includes(r.id));

  test("no rule from the public-prose check matches the cases", () => {
    const hits = banned.filter((r) => r.re.test(text)).map((r) => r.id);
    expect(hits).toEqual([]);
  });

  test("positive control: the same rules catch a real ticket id and a person", () => {
    const sample = '{"body": "see CTC-4355, Ryan said so"}';
    const hits = banned.filter((r) => r.re.test(sample)).map((r) => r.id);
    expect(hits).toContain("ticket-id");
    expect(hits).toContain("named-person");
  });
});

describe("the grader", () => {
  test("a record that meets each case's expectation passes it", () => {
    for (const c of evals.cases) {
      const g = gradeCase(c, passing(c));
      expect({ id: c.id, failures: g.failures }).toEqual({ id: c.id, failures: [] });
    }
  });

  test("a forbidden step, a wrong option, a missed stale field and a missing record each fail", () => {
    const c = evals.cases.find((x) => x.id === "cap-no-code-rounds-conflict");
    const ok = passing(c);
    expect(gradeCase(c, { ...ok, next_steps: [...ok.next_steps, "re-plan"] }).recommendation).toBe(false);
    expect(gradeCase(c, { ...ok, ask_option: "A" }).recommendation).toBe(false);
    expect(gradeCase(c, { ...ok, stale_evidence: [] }).stale).toBe(false);
    expect(gradeCase(c, { ...ok, round_table: [{ round: 1, changed_code: true, cause: "code" }] }).recommendation).toBe(false);
    expect(gradeCase(c, null).pass).toBe(false);
  });

  test("the option comes from ask_option, else the proposed answer's letter", () => {
    expect(optionOf({ ask_option: "B" })).toBe("B");
    expect(optionOf({ ask_option: null })).toBe(null);
    expect(optionOf({ proposed_answer: { option_label: "C — accept as-is" } })).toBe("C");
    expect(optionOf({})).toBe(undefined);
  });
});

describe("the runner", () => {
  test("it extracts the last record object from a reply", () => {
    const reply = 'Some text {"a":1}\n```json\n{"schema":"ask-triage/v1","classification":"mechanical","x":{"y":"}"}}\n```';
    expect(extractRecord(reply)?.classification).toBe("mechanical");
    expect(extractRecord("no json here")).toBe(null);
  });

  test("container mode leaves the checkout block out; checkout mode includes it", () => {
    const c = evals.cases.find((x) => x.inputs.checkout);
    expect(casePrompt(c, evals.steps, false)).not.toContain("## Checkout");
    expect(casePrompt(c, evals.steps, true)).toContain("## Checkout");
  });
});
