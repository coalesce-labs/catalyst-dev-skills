// ask-facts.test.mjs — an ask's raiser attaches facts with --fact, the body carries a parseable
// **Facts:** block, and ask.mjs proves the stored body reads back to the same facts (CTC-4114).
//
// Run: bun test tests/ask-facts.test.mjs
//
// The unit cases import vendor-src/scripts/ask.mjs directly. The CLI cases run the real verb
// against a stub `linearis` on PATH, with a scratch HOME and no config file, so nothing reaches
// Linear. ask.mjs is the SOURCE of the facts format; the mirror's parser ports parseAskFacts.

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  FACTS_HEADING, askFactBullets, buildAskBody, parseAskFacts, parseAskOptions, parseFactArg,
  verifyAskBody, verifyAskFacts,
} from "../vendor-src/scripts/ask.mjs";

const OPTIONS = ["Wait for the check to go green", "Revert the schema publish"];
const ASK = {
  why: "The required check on PR #5211 is red, so the schema publish is waiting.",
  options: OPTIONS,
  defaultIfSilent: "Wait for the check to go green",
  blocks: ["PROJ-4000"],
};
// The body ask.mjs builds at 8bed30e for ASK: captured by running it, pinned so the facts change
// cannot move one byte of an ask filed without --fact.
const BODY_WITHOUT_FACTS = [
  "**Why:** The required check on PR #5211 is red, so the schema publish is waiting.",
  "",
  "**Options:**",
  "- **A** — Wait for the check to go green",
  "- **B** — Revert the schema publish",
  "",
  "**Default if silent:** Wait for the check to go green",
  "",
  "**How to answer:** reply in this thread with the option letter on its own (`A`), `(A)`, `option A`, or the option's own text pasted back. For an answer that is not on the list, reply `DECIDED: <your answer>`.",
  "",
  "Blocks: PROJ-4000",
].join("\n");

describe("parseFactArg — one --fact value", () => {
  test("⭐ POSITIVE CONTROL: the ticket's example is the design mock's first row", () => {
    expect(parseFactArg("Pull request=#5211, required check red"))
      .toEqual({ ok: true, fact: { label: "Pull request", value: "#5211, required check red" } });
  });
  test("splits on the FIRST '=' and trims each side", () => {
    expect(parseFactArg("Ratio=a=b: c").fact).toEqual({ label: "Ratio", value: "a=b: c" });
    expect(parseFactArg("  Owner  =  platform team  ").fact).toEqual({ label: "Owner", value: "platform team" });
  });
  test("refusals carry a frozen reason and a one-line fix", () => {
    const cases = [
      [undefined, "fact-missing-value"], ["no separator", "fact-no-separator"],
      ["=value", "fact-empty-label"], ["  =  ", "fact-empty-label"],
      ["label=", "fact-empty-value"], ["label=   ", "fact-empty-value"],
      ["a\nb=c", "fact-multiline"], ["k=v\r", "fact-multiline"],
    ];
    for (const [raw, reason] of cases) {
      const r = parseFactArg(raw);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe(reason);
      expect(r.message).toContain('--fact "<label>=<value>"');
    }
  });
});

describe("buildAskBody — the Facts block", () => {
  test("without facts the body is byte-identical to 8bed30e", () => {
    expect(buildAskBody(ASK)).toBe(BODY_WITHOUT_FACTS);
    expect(buildAskBody({ ...ASK, facts: [] })).toBe(BODY_WITHOUT_FACTS);
  });
  test("with facts the block is appended LAST, escaped, in flag order", () => {
    const facts = [
      { label: "Pull request", value: "#5211, required check red" },
      { label: "Glob", value: "images/runner/**" },
    ];
    expect(buildAskBody({ ...ASK, facts })).toBe(
      `${BODY_WITHOUT_FACTS}\n\n${FACTS_HEADING}\n- **Pull request:** #5211, required check red\n- **Glob:** images/runner/\\*\\*`
    );
  });
  test("the options still parse and verify with a Facts block present, whatever a fact is called", () => {
    for (const label of ["Options", "Default if silent", "How to answer", "Facts", "A"]) {
      const body = buildAskBody({ ...ASK, facts: [{ label, value: "x" }] });
      expect(parseAskOptions(body)).toEqual(OPTIONS);
      expect(verifyAskBody({ intendedOptions: OPTIONS, storedBody: body }).ok).toBe(true);
    }
  });
});

describe("parseAskFacts — reading the block back", () => {
  const AWKWARD = [
    { label: "Pull request", value: "#5211, required check red" },
    { label: "Query", value: "a_b?c=1&d=2 <x> `y`" },
    { label: "Ratio:", value: "a=b: c" },
    { label: "Default if silent", value: "not the real default" },
    { label: "Path", value: "C:\\tmp\\*x" },
    { label: "Glob", value: "images/runner/**" },
    { label: "Link", value: "[docs](https://x.y/a)" },
    { label: "Coût", value: "€5 — ok ~/catalyst" },
  ];
  const body = buildAskBody({ ...ASK, facts: AWKWARD });
  test("every awkward fact reads back word for word", () => expect(parseAskFacts(body)).toEqual(AWKWARD));
  test("Linear-style normalization does not change what reads back", () => {
    const variants = {
      "escapes Linear does not need are dropped": body.replace(/\\([_&<>`])/g, "$1"),
      "escapes Linear adds (#)": body.replace(/(?<=\*\* )#/g, "\\#"),
      "bullets rewritten to *": body.replace(/\n- \*\*/g, "\n* **"),
      "trailing spaces and newline": `${body}  \n`,
      "CRLF line endings": body.replace(/\n/g, "\r\n"),
    };
    for (const v of Object.values(variants)) expect(parseAskFacts(v)).toEqual(AWKWARD);
  });
  test("the LAST header wins, so --why cannot shadow the raiser's facts", () => {
    const facts = [{ label: "Pull request", value: "#5211" }];
    const planted = buildAskBody({ ...ASK, why: "context\n**Facts:**\n- **Planted:** from the why", facts });
    expect(parseAskFacts(planted)).toEqual(facts);
    expect(parseAskFacts(buildAskBody({ ...ASK, why: "Facts:\nthe check is red", facts }))).toEqual(facts);
  });
  test("no block, a header in prose, or a header with no items reads as []", () => {
    expect(parseAskFacts(BODY_WITHOUT_FACTS)).toEqual([]);
    expect(parseAskFacts("**Why:** Facts: the check is red")).toEqual([]);
    expect(parseAskFacts("**Facts:**\nnot an item")).toEqual([]);
    expect(parseAskFacts("")).toEqual([]);
    expect(parseAskFacts(undefined)).toEqual([]);
  });
  test("the list ends at the first blank line or non-item line", () => {
    expect(parseAskFacts("**Facts:**\n- **a:** 1\n\n- **b:** 2")).toEqual([{ label: "a", value: "1" }]);
    expect(parseAskFacts("**Facts:**\n- **a:** 1\nprose\n- **b:** 2")).toEqual([{ label: "a", value: "1" }]);
  });
});

describe("verifyAskFacts — the round trip", () => {
  const facts = [{ label: "Pull request", value: "#5211, required check red" }, { label: "Blocked since", value: "09:40 UTC" }];
  const body = buildAskBody({ ...ASK, facts });
  test("no facts attached: nothing to verify", () => {
    expect(verifyAskFacts({ intendedFacts: [], storedBody: BODY_WITHOUT_FACTS }).ok).toBe(true);
  });
  test("the reasons, in the order verifyAskBody uses", () => {
    expect(verifyAskFacts({ intendedFacts: facts, storedBody: body })).toMatchObject({ ok: true, reason: null });
    expect(verifyAskFacts({ intendedFacts: facts, storedBody: BODY_WITHOUT_FACTS }).reason).toBe("facts-unreadable");
    expect(verifyAskFacts({ intendedFacts: facts, storedBody: body.replace(/\n- \*\*Blocked since.*$/, "") }).reason).toBe("fact-count-mismatch");
    const changed = verifyAskFacts({ intendedFacts: facts, storedBody: body.replace("09:40 UTC", "09:41 UTC") });
    expect(changed).toMatchObject({ ok: false, reason: "fact-text-mismatch", note: "fact 2 differs" });
  });
});

// Every CLI case spawns node; under run-tests.sh the suites run in parallel.
setDefaultTimeout(30000);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ASK_CLI = join(repoRoot, "vendor-src/scripts/ask.mjs");
const T = mkdtempSync(join(tmpdir(), "ask-facts-"));
afterAll(() => rmSync(T, { recursive: true, force: true }));

// The stub answers the three linearis calls create makes and logs each one. STUB_DROP_FACTS
// stores the body without its Facts block, as a Linear that mangled it would.
const STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2), dir = process.env.STUB_DIR;
fs.appendFileSync(dir + "/calls.log", a.slice(0, 2).join(" ") + "\\n");
if (a[0] === "labels" && a[1] === "list") {
  console.log(JSON.stringify({ nodes: [{ id: "lbl-ask", name: "catalyst-ask" }, { id: "lbl-dec", name: "ask/decision" }] }));
} else if (a[0] === "issues" && a[1] === "create") {
  let description = a[a.indexOf("--description") + 1];
  if (process.env.STUB_DROP_FACTS === "1") description = description.replace(/\\n\\n\\*\\*Facts:\\*\\*[\\s\\S]*$/, "");
  const blocks = a.flatMap((v, i) => (v === "--blocks" ? [a[i + 1]] : []));
  fs.writeFileSync(dir + "/stored.json", JSON.stringify({ description, blocks }));
  console.log(JSON.stringify({ identifier: "PROJ-77" }));
} else if (a[0] === "issues" && a[1] === "read") {
  const s = JSON.parse(fs.readFileSync(dir + "/stored.json", "utf8"));
  console.log(JSON.stringify({ identifier: a[2], description: s.description,
    relations: { nodes: s.blocks.map((b) => ({ type: "blocks", relatedIssue: { identifier: b } })) } }));
} else { console.error("stub: unhandled " + a.join(" ")); process.exit(1); }
`;

let n = 0;
function runAsk(extra, stubEnv = {}) {
  const dir = join(T, `r${++n}`);
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin/linearis"), STUB, { mode: 0o755 });
  const env = {
    PATH: `${join(dir, "bin")}:${process.env.PATH}`, HOME: dir, STUB_DIR: dir,
    CATALYST_CONFIG_FILE: join(dir, "none.json"), CATALYST_LAYER2_CONFIG_FILE: join(dir, "none2.json"),
    ASK_TEAM: "PROJ", ASK_HUMAN_ID: "00000000-0000-0000-0000-000000000001", ...stubEnv,
  };
  const args = ["create", "--title", "Pick the lane for the red check", "--why", ASK.why,
    "--option", OPTIONS[0], "--option", OPTIONS[1], "--default", ASK.defaultIfSilent, "--blocks", "PROJ-4000", ...extra];
  const r = spawnSync("node", [ASK_CLI, ...args], { cwd: dir, env, encoding: "utf8" });
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : null);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls: (read("calls.log") ?? "").trim().split("\n").filter(Boolean),
    stored: read("stored.json") && JSON.parse(read("stored.json")).description };
}
const FACT_FLAGS = ["--fact", "Pull request=#5211, required check red", "--fact", "Blocked since=09:40 UTC"];
const FACTS = [{ label: "Pull request", value: "#5211, required check red" }, { label: "Blocked since", value: "09:40 UTC" }];

describe("ask.mjs create --fact (stub linearis)", () => {
  test("dry run: the body ends with the block and parsedFacts lists the facts", () => {
    const r = runAsk([...FACT_FLAGS, "--dry-run"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.body).toBe(`${BODY_WITHOUT_FACTS}\n\n**Facts:**\n- **Pull request:** #5211, required check red\n- **Blocked since:** 09:40 UTC`);
    expect(out.parsedFacts).toEqual(FACTS);
    expect(r.calls).toEqual(["labels list"]); // a dry run files nothing
  });
  test("filed: the stored body carries the block and the read-back verifies it", () => {
    const r = runAsk(FACT_FLAGS);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ action: "created", decidable: true, factsVerified: true, factsReason: null, parsedFacts: FACTS });
    expect(parseAskFacts(r.stored)).toEqual(FACTS);
  });
  test("a malformed --fact refuses with exit 1 before any linearis call", () => {
    for (const extra of [["--fact", "Pull request #5211"], ["--fact", "Owner="], ["--fact", "=x"], ["--fact", "a\nb=c"], ["--fact"]]) {
      const r = runAsk(extra);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("ask create: REFUSING — --fact");
      expect(r.stderr).toContain("Nothing was filed.");
      expect(r.calls).toEqual([]);
    }
  });
  test("facts that do not read back: exit 0, factsVerified false, a ⚠️ on stderr, options still decidable", () => {
    const r = runAsk(FACT_FLAGS, { STUB_DROP_FACTS: "1" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ decidable: true, blocksVerified: true, factsVerified: false, factsReason: "facts-unreadable", parsedFacts: [] });
    expect(r.stderr).toContain("⚠️ PROJ-77 is filed and answerable, but its facts did not read back word for word");
  });
  test("without --fact: body unchanged, parsedFacts [] and factsVerified true", () => {
    const dry = runAsk(["--dry-run"]);
    expect(JSON.parse(dry.stdout)).toMatchObject({ body: BODY_WITHOUT_FACTS, parsedFacts: [] });
    const filed = runAsk([]);
    expect(filed.status).toBe(0);
    expect(JSON.parse(filed.stdout)).toMatchObject({ factsVerified: true, factsReason: null, parsedFacts: [] });
  });
  test("the usage text documents --fact", () => {
    const r = spawnSync("node", [ASK_CLI], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('[--fact "<label>=<value>" ...]');
  });
});
