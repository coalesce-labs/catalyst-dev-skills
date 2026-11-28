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
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { RULES } from "../scripts/check-public-prose.mjs";
import { gradeCase, gradeAll, optionOf } from "../skills/unsticker/evals/grade.mjs";
import { extractRecord, casePrompt, skillText } from "../skills/unsticker/evals/run.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(`${root}${rel}`, "utf8");
const evals = JSON.parse(read("skills/unsticker/evals/evals.json"));
const steps = Object.keys(evals.steps);
const caseById = (id) => evals.cases.find((c) => c.id === id);

/** One round row per platform cause the case names (or one generic row), each citing its first keyword. */
function roundRows(e) {
  const groups = e.platform_causes ?? [];
  if (groups.length === 0) return [{ round: 1, changed_code: false, cause: "platform", evidence: "x" }];
  return groups.map((g, i) => ({ round: i + 1, changed_code: false, cause: "platform", evidence: g[0] }));
}

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
    round_table: e.no_code_rounds ? roundRows(e) : [],
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

  test("positive control: the same rules catch a ticket id and the owner's name", () => {
    // CTC-0 never exists; the named-person rule matches only the owner's name, which the rule itself
    // and tests/public-prose.test.mjs already carry.
    const sample = '{"body": "see CTC-0, Ryan said so"}';
    const hits = banned.filter((r) => r.re.test(sample)).map((r) => r.id);
    expect(hits).toContain("ticket-id");
    expect(hits).toContain("named-person");
  });
});

// The cases once carried 8-hex commit ids and repository paths from a private repository. These
// rules keep them out: a commit-id-like token must be in the synthetic scheme (00NN then one hex
// letter four times, such as 0001aaaa), and no text names an apps/, packages/ or scripts/ path or
// the word "staging". Epoch-millisecond numbers (13 digits) are not commit ids.
const SYNTHETIC_SHA = /^00\d\d([a-f])\1{3}$/;

/** Everything in `text` the public repository must not carry, by rule. */
function privateLeaks(text) {
  const hex = (text.match(/\b[0-9a-f]{7,40}\b/g) ?? []).filter((t) => !SYNTHETIC_SHA.test(t) && !/^\d{13}$/.test(t));
  const paths = text.match(/(?<![\w.-])(?:apps|packages|scripts)\/[\w./@-]*/g) ?? [];
  const staging = text.match(/\bstaging\b/gi) ?? [];
  return { hex, paths, staging };
}

describe("the eval set carries no private repository detail", () => {
  const files = [
    "skills/unsticker/evals/evals.json",
    "skills/unsticker/evals/run.mjs",
    "skills/unsticker/evals/grade.mjs",
    "skills/unsticker/evals/README.md",
  ];

  test("no commit-id-like token outside the synthetic scheme, no apps/ packages/ scripts/ path, no staging", () => {
    for (const file of files) {
      expect({ file, ...privateLeaks(read(file)) }).toEqual({ file, hex: [], paths: [], staging: [] });
    }
  });

  test("the cases do use the synthetic commit ids", () => {
    const ids = read("skills/unsticker/evals/evals.json").match(/\b00\d\d[a-f]{4}\b/g) ?? [];
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) expect(id).toMatch(SYNTHETIC_SHA);
  });

  test("positive control: a real-looking commit id is flagged", () => {
    expect(privateLeaks("pushed 9f3a7c1e to the branch").hex).toEqual(["9f3a7c1e"]);
    expect(privateLeaks("head 3f786850e387550fdab836ed7e6dc881de23001b").hex).toHaveLength(1);
  });

  test("positive control: an apps/, packages/ or scripts/ path is flagged", () => {
    for (const root of ["apps", "packages", "scripts"]) expect(privateLeaks(`failed at ${root}/core/src/index.ts:12`).paths).toHaveLength(1);
  });

  test("positive control: the word staging is flagged, in any case", () => {
    expect(privateLeaks("recorded on staging").staging).toEqual(["staging"]);
    expect(privateLeaks("Staging admin sign-in").staging).toEqual(["Staging"]);
  });

  test("a fixture with all three is flagged by every rule, and a clean string passes", () => {
    const dirty = privateLeaks("pushed 9f3a7c1e, see apps/web/test/a.test.ts, recorded on staging");
    expect(dirty.hex.length).toBe(1);
    expect(dirty.paths.length).toBe(1);
    expect(dirty.staging.length).toBe(1);
    const clean = privateLeaks("pushed 0001aaaa, see src/index.ts and test/posture.test.ts at 1899533460000, recorded on the preview");
    expect(clean).toEqual({ hex: [], paths: [], staging: [] });
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

describe("the grader reads the scenarios as written", () => {
  /** Remove every occurrence of `needle` from a record, wherever it sits. */
  const without = (record, needle) => JSON.parse(JSON.stringify(record).split(needle).join("x"));

  test("a stale field named only in `said` does not count", () => {
    const c = caseById("cap-fixed-defect-accept-review");
    const ok = passing(c);
    expect(gradeCase(c, ok).stale).toBe(true);
    const moved = { ...ok, stale_evidence: c.expected.stale.map((g) => ({ field: "note", said: g.join(" "), newer: "", source: "" })) };
    const g = gradeCase(c, moved);
    expect(g.stale).toBe(false);
    expect(g.pass).toBe(false);
  });

  test("the stale report names each stale case and its field", () => {
    const dir = mkdtempSync(join(tmpdir(), "unsticker-grade-"));
    for (const c of evals.cases) writeFileSync(join(dir, `${c.id}.json`), JSON.stringify(passing(c)));
    const staleIds = evals.cases.filter((c) => (c.expected.stale ?? []).length > 0).map((c) => c.id);
    expect(staleIds).toHaveLength(8);

    const g = gradeAll(evals, dir);
    expect(g.staleReport.map((r) => r.id)).toEqual(staleIds);
    for (const r of g.staleReport) {
      expect(r.group).toEqual(caseById(r.id).expected.stale);
      expect(r.named).toBe(true);
      expect(r.fields).toEqual(r.group.map((grp) => grp[0]));
      expect(r.unplanted).toEqual([]);
    }

    // An entry the case did not plant is reported under `unplanted` and costs the case nothing.
    const c = caseById("cap-stale-base-unused-export");
    const extra = { field: "snapshot.subjects[0].labels", said: "x", newer: "y", source: "z" };
    writeFileSync(join(dir, `${c.id}.json`), JSON.stringify({ ...passing(c), stale_evidence: [...passing(c).stale_evidence, extra] }));
    // A record that names none of a case's stale fields is reported as not named.
    const d = caseById("cap-date-bomb-fixed-on-main");
    writeFileSync(join(dir, `${d.id}.json`), JSON.stringify({ ...passing(d), stale_evidence: [] }));
    const h = gradeAll(evals, dir);
    const entry = (id) => h.staleReport.find((r) => r.id === id);
    expect(entry(c.id)).toMatchObject({ named: true, unplanted: ["snapshot.subjects[0].labels"] });
    expect(h.results.find((r) => r.id === c.id).pass).toBe(true);
    expect(entry(d.id)).toMatchObject({ named: false, fields: [null], unplanted: [] });
    expect(h.results.find((r) => r.id === d.id).stale).toBe(false);

    // The command line carries the same report: `--json` as `staleReport`, text mode as a block.
    const gradeCli = fileURLToPath(new URL("../skills/unsticker/evals/grade.mjs", import.meta.url));
    const json = spawnSync("node", [gradeCli, dir, "--json"], { encoding: "utf8" });
    expect(JSON.parse(json.stdout).staleReport.map((r) => r.id)).toEqual(staleIds);
    const text = spawnSync("node", [gradeCli, dir], { encoding: "utf8" });
    expect(text.stdout).toContain("stale evidence read");
    for (const id of staleIds) expect(text.stdout).toContain(id);
  });

  test("a no-code-rounds record must name the platform causes and lead with the mechanical step", () => {
    const c = caseById("cap-no-code-rounds-conflict");
    expect(c.expected.platform_causes.length).toBeGreaterThanOrEqual(3);
    const ok = passing(c);
    expect(gradeCase(c, ok).recommendation).toBe(true);

    // Without the drain cause, in the rows and in `root_cause`, the record fails.
    const named = { ...ok, root_cause: "stage_marker_drain_incomplete, supervised_pr_review_missing, supervised_validate_scenarios" };
    expect(gradeCase(c, named).recommendation).toBe(true);
    const missing = gradeCase(c, without(named, "stage_marker_drain"));
    expect(missing.recommendation).toBe(false);
    expect(missing.failures.join("\n")).toContain("platform_causes");

    // A cause named only in `root_cause` is enough, and so is one named only in a row's evidence.
    const rootOnly = { ...ok, root_cause: c.expected.platform_causes.map((g) => g[0]).join("; "), round_table: [{ round: 1, changed_code: false, cause: "platform", evidence: "x" }] };
    expect(gradeCase(c, rootOnly).recommendation).toBe(true);

    // The first step must be mechanical.
    for (const first of ["fix-on-branch", "grant-round", "route-to-capable-agent"]) {
      expect(gradeCase(c, { ...ok, next_steps: [first, ...ok.next_steps] }).recommendation).toBe(false);
    }
    for (const first of ["review-at-head", "release-lever", "wait"]) {
      expect(gradeCase(c, { ...ok, next_steps: [first, ...ok.next_steps] }).recommendation).toBe(true);
    }

    // The other no-code-rounds case has one platform cause.
    const r = caseById("cap-review-skipped-no-validate-record");
    expect(r.expected.platform_causes).toHaveLength(1);
    expect(gradeCase(r, passing(r)).recommendation).toBe(true);
    expect(gradeCase(r, without(passing(r), "supervised_pr_review_missing")).recommendation).toBe(false);
    expect(gradeCase(r, { ...passing(r), next_steps: ["fix-on-branch", "rerun-validate"] }).recommendation).toBe(false);
  });

  test("the recording case fails a record that sends it to a person", () => {
    const c = caseById("recording-needed-agent-records");
    expect(c.expected.reaches_human).toBe(false);
    expect(gradeCase(c, passing(c)).recommendation).toBe(true);
    const g = gradeCase(c, { ...passing(c), reaches_human: true });
    expect(g.recommendation).toBe(false);
    expect(g.failures.join("\n")).toContain("reaches_human");
  });
});

describe("the runner refuses to report a score for a failed model call", () => {
  const runMjs = fileURLToPath(new URL("../skills/unsticker/evals/run.mjs", import.meta.url));
  const tmp = () => mkdtempSync(join(tmpdir(), "unsticker-run-"));
  const stub = (dir, name, body) => {
    const file = join(dir, name);
    writeFileSync(file, body);
    return file;
  };
  const reading = (reply) => `let p="";process.stdin.on("data",(d)=>(p+=d));process.stdin.on("end",()=>{${reply}});`;
  const run = (out, cases, cmd, env = {}, extra = []) =>
    spawnSync("node", [runMjs, "--out", out, "--cases", cases, ...extra], { encoding: "utf8", env: { ...process.env, UNSTICKER_EVAL_CMD: cmd, ...env } });
  const record = JSON.stringify({ schema: "ask-triage/v1", classification: "mechanical", next_steps: ["close-moot"] });
  const okReply = `console.log(JSON.stringify({result:"Done.\\n"+${JSON.stringify(record)},total_cost_usd:0.01}));`;
  const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

  test("a failed model call writes no record and fails the run", () => {
    const dir = tmp();
    const out = join(dir, "out");
    const id = "cap-subject-merged";
    // is_error: true, as `claude -p` reports a login that expired
    const loggedOut = stub(dir, "logged-out.mjs", reading(`console.log(JSON.stringify({is_error:true,result:"Not logged in",total_cost_usd:0}));`));
    let r = run(out, id, `node ${loggedOut}`);
    expect(r.status).toBe(3);
    expect(existsSync(join(out, `${id}.json`))).toBe(false);
    expect(r.stdout).toContain(`error ${id}`);
    expect(r.stdout).toContain("Not logged in");
    expect(readJson(join(out, "run.json"))).toMatchObject({ cases: 1, errors: 1 });

    // a non-zero exit, with a reply that would otherwise parse
    const crashed = stub(dir, "crashed.mjs", reading(`${okReply}process.exitCode=2;`));
    r = run(out, id, `node ${crashed}`);
    expect(r.status).toBe(3);
    expect(existsSync(join(out, `${id}.json`))).toBe(false);
    expect(r.stdout).toContain(`error ${id}`);

    // a command that cannot start
    r = run(out, id, join(dir, "no-such-command"));
    expect(r.status).toBe(3);
    expect(r.stdout).toContain(`error ${id}`);
  });

  test("a failed call removes the record an earlier run left in the same directory", () => {
    const dir = tmp();
    const id = "cap-subject-merged";
    writeFileSync(join(dir, `${id}.json`), record);
    const loggedOut = stub(dir, "logged-out.mjs", reading(`console.log(JSON.stringify({is_error:true,result:"Not logged in"}));`));
    expect(run(dir, id, `node ${loggedOut}`).status).toBe(3);
    expect(existsSync(join(dir, `${id}.json`))).toBe(false);
  });

  test("when some calls fail and some do not, the run exits 1 and keeps the good records", () => {
    const dir = tmp();
    const out = join(dir, "out");
    const bad = "cap-subject-merged";
    const good = "cap-rebase-conflict-parked";
    const mixed = stub(dir, "mixed.mjs", reading(`if(p.includes(process.env.STUB_FAIL_ON)){console.log(JSON.stringify({is_error:true,result:"overloaded"}));}else{${okReply}}`));
    const r = run(out, `${bad},${good}`, `node ${mixed}`, { STUB_FAIL_ON: `Triage ask ${caseById(bad).inputs.ask.identifier}.` }, ["--jobs", "1"]);
    expect(r.status).toBe(1);
    expect(existsSync(join(out, `${bad}.json`))).toBe(false);
    expect(readJson(join(out, `${good}.json`)).classification).toBe("mechanical");
    expect(r.stdout).toContain(`error ${bad}`);
    expect(readJson(join(out, "run.json"))).toMatchObject({ cases: 2, errors: 1 });
  });

  test("a run writes run.json", () => {
    const dir = tmp();
    const out = join(dir, "out");
    const id = "cap-subject-merged";
    const ok = stub(dir, "ok.mjs", reading(okReply));
    const r = run(out, id, `node ${ok}`);
    expect(r.status).toBe(0);
    expect(readJson(join(out, `${id}.json`)).classification).toBe("mechanical");
    const meta = readJson(join(out, "run.json"));
    expect(meta).toMatchObject({ cases: 1, errors: 0, costUsd: 0.01, model: "sonnet" });
    expect(meta.skillSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.skillDir).toBe(fileURLToPath(new URL("../skills/unsticker", import.meta.url)).replace(/\/$/, ""));
    expect(meta.skillSha256).toBe(createHash("sha256").update(skillText(meta.skillDir)).digest("hex"));
  });
});

describe("the skill text matches the snapshot it reads", () => {
  const skillFiles = ["skills/unsticker/SKILL.md", ...readdirSync(`${root}skills/unsticker/references`).filter((f) => f.endsWith(".md")).map((f) => `skills/unsticker/references/${f}`)];

  /** Every key the eval snapshots use at the top, per subject, and in a subject's ledger, eligibility, leases and pull requests. */
  function snapshotKeys() {
    const keys = new Set();
    const add = (o) => Object.keys(o ?? {}).forEach((k) => keys.add(k));
    for (const c of evals.cases) {
      const snap = c.inputs.snapshot;
      add(snap);
      for (const sub of snap.subjects ?? []) {
        add(sub);
        add(sub.ledger);
        add(sub.eligibility);
        for (const lease of sub.leases ?? []) add(lease);
        for (const pr of sub.pullRequests ?? []) add(pr);
      }
    }
    return [...keys].sort();
  }

  test("the skill names the snapshot's real fields and no field it lacks", () => {
    const container = read("skills/unsticker/references/container.md");
    const keys = snapshotKeys();
    for (const k of ["capturedAtMs", "deadlineMs", "failureClass", "fenced", "mergeableState"]) expect(keys).toContain(k);
    expect(keys.filter((k) => !container.includes(`\`${k}\``))).toEqual([]);

    // The snapshot holds no lease heartbeats, so no reference sends a container to them.
    for (const file of skillFiles) expect({ file, heartbeat: /heartbeat/i.test(read(file)) }).toEqual({ file, heartbeat: false });

    // The snapshot holds no checks and no review threads: each laptop instruction that reads them says a container does not.
    const lineWith = (file, re) => read(file).split("\n").find((l) => re.test(l));
    expect(lineWith("skills/unsticker/SKILL.md", /failing checks/)).toMatch(/container/);
    expect(lineWith("skills/unsticker/references/investigate.md", /statusCheckRollup/)).toMatch(/container/);
    expect(lineWith("skills/unsticker/references/investigate.md", /failing checks/)).toMatch(/container/);
    expect(container).toMatch(/no check results or review threads/);

    // The snapshot lists open PRs only, so a merge shows as Done or Canceled, or as a comment with no open PR row.
    const premise = lineWith("skills/unsticker/references/container.md", /^2\. \*\*Check the premise first/);
    expect(premise).not.toMatch(/its PR merged/i);
    expect(premise).toMatch(/no open PR/);
    expect(container).toMatch(/no merged PRs/);
    const cap = read("skills/unsticker/references/repair-cap.md");
    expect(cap).not.toMatch(/its PR merged/i);
    expect(lineWith("skills/unsticker/references/repair-cap.md", /`close-moot`/)).toMatch(/no open PR/);
    expect(read("skills/unsticker/references/classify.md")).toMatch(/lease deadlines/);
  });

  test("record.md points at the repair-cap steps whose tables map steps to letters", () => {
    const record = read("skills/unsticker/references/record.md");
    expect(record).not.toContain("step 5 maps steps to letters");
    expect(record).toMatch(/steps 1 and 4 map steps to letters/);
    const cap = read("skills/unsticker/references/repair-cap.md");
    expect(cap).toMatch(/^## 1\. /m);
    expect(cap).toMatch(/^## 4\. /m);
  });
});
