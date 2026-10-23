import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTeamLabelIds } from "../vendor-src/scripts/ask.mjs";

const NAMES = ["catalyst-ask", "ask/decision"];
const labels = (prefix, names = NAMES) => names.map((name, i) => ({ id: `${prefix}-${i}`, name }));
const page = (nodes, hasNextPage = false, endCursor = null) => ({ nodes, pageInfo: { hasNextPage, endCursor } });
const response = (value) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });
const teamArgs = ["labels", "list", "--team", "CTC", "--limit", "250"];
const workspaceArgs = ["labels", "list", "--scope", "workspace", "--limit", "250"];

function resolve(teamPages, workspacePages = [], names = NAMES) {
  const calls = [];
  const queues = { team: [...teamPages], workspace: [...workspacePages] };
  const result = resolveTeamLabelIds("CTC", { names, runFn: (cmd, args) => {
    expect(cmd).toBe("linearis");
    calls.push(args);
    const scope = args.includes("--team") ? "team" : args.includes("--scope") ? "workspace" : "unscoped";
    // An unscoped result could contain another team's labels, without team metadata.
    if (scope === "unscoped") return response(page(labels("foreign")));
    const next = queues[scope].shift();
    if (next === undefined) throw new Error(`Unexpected label request: ${args.join(" ")}`);
    return next;
  } });
  return { ...result, calls };
}

describe("ask label resolution", () => {
  test("workspace-only labels use an explicit workspace scope", () => {
    const r = resolve([response(page([]))], [response(page(labels("workspace")))]);
    expect(r).toMatchObject({ ok: true, labelIds: ["workspace-0", "workspace-1"] });
    expect(r.calls).toEqual([teamArgs, workspaceArgs]);
  });
  test("team-only resolution avoids workspace lookup", () => {
    const r = resolve([response(page(labels("team")))]);
    expect(r.labelIds).toEqual(["team-0", "team-1"]);
    expect(r.calls).toEqual([teamArgs]);
  });
  test("team labels win even over duplicate workspace names", () => {
    const r = resolve([response(page([labels("team")[1]]))],
      [response(page([...labels("workspace"), { id: "duplicate", name: NAMES[1] }]))]);
    expect(r.labelIds).toEqual(["workspace-0", "team-1"]);
  });
  test("configured names including a third label retain configured order", () => {
    const names = ["help", "decision", "needs-person"];
    const r = resolve([response(page([labels("team", names)[1]]))],
      [response(page(labels("workspace", names)))], names);
    expect(r.labelIds).toEqual(["workspace-0", "team-1", "workspace-2"]);
  });
  test("missing names refuse after both scopes, never using an unscoped match", () => {
    const r = resolve([response(page([]))], [response(page([]))]);
    expect(r).toMatchObject({ ok: false, reason: "label-not-found" });
    expect(r.detail).toContain(NAMES[0]);
    expect(r.detail).toContain("CTC");
    expect(r.detail).toContain("workspace");
    expect(r.calls).toEqual([teamArgs, workspaceArgs]);
  });
  test("distinct IDs for one name refuse in the selected scope", () => {
    for (const scope of ["team", "workspace"]) {
      const ambiguous = response(page([...labels(scope), { id: "other", name: NAMES[0] }]));
      const r = scope === "team" ? resolve([ambiguous]) : resolve([response(page([]))], [ambiguous]);
      expect(r).toMatchObject({ ok: false, reason: "label-ambiguous" });
    }
  });
  test("later team pages win before workspace fallback", () => {
    const r = resolve([response(page([], true, "team-next")), response(page([labels("team")[1]]))],
      [response(page(labels("workspace")))]);
    expect(r.labelIds).toEqual(["workspace-0", "team-1"]);
    expect(r.calls).toEqual([teamArgs, [...teamArgs, "--after", "team-next"], workspaceArgs]);
  });
  test("later workspace pages resolve and repeated IDs are not ambiguous", () => {
    const r = resolve([response(page([]))], [response(page([labels("workspace")[0]], true, "next")),
      response(page(labels("workspace")))]);
    expect(r.labelIds).toEqual(["workspace-0", "workspace-1"]);
    expect(r.calls[2]).toEqual([...workspaceArgs, "--after", "next"]);
  });
  test("duplicates across pages refuse even after all names first matched", () => {
    for (const scope of ["team", "workspace"]) {
      const pages = [response(page(labels(scope), true, "next")), response(page([{ id: "other", name: NAMES[0] }]))];
      const r = scope === "team" ? resolve(pages) : resolve([response(page([]))], pages);
      expect(r).toMatchObject({ ok: false, reason: "label-ambiguous" });
    }
  });
  test("nodes-only legacy responses are terminal pages", () => {
    expect(resolve([response({ nodes: labels("team") })]).labelIds).toEqual(["team-0", "team-1"]);
  });
  test("failed listing identifies the command and bounds stderr", () => {
    const r = resolve([response(page([]))], [{ code: 1, stdout: "", stderr: `unsupported --scope ${"x".repeat(1000)}` }]);
    expect(r).toMatchObject({ ok: false, reason: "label-list-failed" });
    expect(r.detail).toContain("--scope workspace");
    expect(r.detail).toContain("unsupported --scope");
    expect(r.detail.length).toBeLessThan(400);
  });
  test("malformed listing or pagination refuses in either scope", () => {
    const bad = [
      { code: 0, stdout: "not json", stderr: "" }, response({}), response({ nodes: null }),
      response({ nodes: labels("bad"), pageInfo: null }), response({ nodes: labels("bad"), pageInfo: {} }),
      response(page(labels("bad"), "false")), response(page(labels("bad"), true)),
      response(page(labels("bad"), true, " ")), response(page(labels("bad"), false, 42)),
      response(page([null])), response(page([{ name: NAMES[0], id: "" }])),
    ];
    for (const value of bad) {
      for (const scope of ["team", "workspace"]) {
        const r = scope === "team" ? resolve([value]) : resolve([response(page([]))], [value]);
        expect(r).toMatchObject({ ok: false, reason: "label-list-unparseable" });
      }
    }
  });
  test("a repeated cursor refuses instead of looping", () => {
    const r = resolve([response(page([], true, "same")), response(page([], true, "same"))]);
    expect(r).toMatchObject({ ok: false, reason: "label-list-unparseable" });
    expect(r.calls).toHaveLength(2);
  });
});

setDefaultTimeout(30000);
const ASK_CLI = fileURLToPath(new URL("../vendor-src/scripts/ask.mjs", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "ask-create-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
// This stub stores scalar mutations independently of the description and final verifier.
const STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const dir = process.env.STUB_DIR;
const config = JSON.parse(fs.readFileSync(dir + "/config.json", "utf8"));
const args = process.argv.slice(2);
const value = (flag) => args.includes(flag) ? args[args.lastIndexOf(flag) + 1] : null;
const emit = (v) => console.log(JSON.stringify(v));
const read = () => JSON.parse(fs.readFileSync(dir + "/stored.json", "utf8"));
const save = (s) => fs.writeFileSync(dir + "/stored.json", JSON.stringify(s));
fs.appendFileSync(dir + "/calls.jsonl", JSON.stringify(args) + "\\n");
if (args[0] === "labels" && args[1] === "list") {
  const scope = value("--team") ? "team" : value("--scope") === "workspace" ? "workspace" : "unscoped";
  if (config.labelFailure === scope) { console.error("unsupported label query"); process.exit(1); }
  emit({ nodes: config[scope] || [] });
} else if (args[0] === "issues" && args[1] === "create") {
  if (config.createFailure) process.exit(1);
  const block = value("--blocks");
  save({ description: value("--description"), labels: value("--labels").split(","),
    blocks: config.omit?.includes(block) ? [] : [block] });
  emit({ identifier: config.identifier || "CTC-9000" });
} else if (args[0] === "issues" && args[1] === "update") {
  const block = value("--blocks"), s = read();
  const fails = config.failUpdates?.includes(block);
  if (!config.omit?.includes(block) && (!fails || config.persistFailedUpdate)) s.blocks.push(block);
  save(s);
  if (fails) { console.error("update rejected " + "x".repeat(1000)); process.exit(1); }
  emit({ success: true });
} else if (args[0] === "issues" && args[1] === "read") {
  if (config.readFailure) process.exit(1);
  if (config.readMalformed) { console.log("not json"); process.exit(0); }
  const s = read();
  emit({ description: config.storedBody ?? s.description,
    ...(config.relationFields ?? { relations: { nodes: s.blocks.map(identifier => ({ type: "blocks", relatedIssue: { identifier } })) } }) });
} else { console.error("Unexpected command"); process.exit(1); }
`;
let sequence = 0;
const BLOCKS = ["CTC-1040", "CTC-1175", "CTC-1241"];
function runAsk(config = {}, { blocks = [BLOCKS[0]], extra = [], env = {} } = {}) {
  const dir = join(scratch, String(++sequence));
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin/linearis"), STUB, { mode: 0o755 });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ team: labels("team"), ...config }));
  const r = spawnSync("node", [ASK_CLI, "create", "--team", "CTC", "--title", "Choose a release date",
    "--why", "The release needs a date.", "--option", "Wait", "--option", "Release", "--default", "Wait",
    "--fact", "Owner=Release team", ...blocks.flatMap(id => ["--blocks", id]), ...extra], {
    cwd: dir, encoding: "utf8", env: {
      PATH: `${join(dir, "bin")}:${process.env.PATH}`, HOME: dir, STUB_DIR: dir,
      CATALYST_CONFIG_FILE: join(dir, "none.json"), CATALYST_LAYER2_CONFIG_FILE: join(dir, "none2.json"),
      ASK_HUMAN_ID: "00000000-0000-0000-0000-000000000001", ...env,
    },
  });
  const callsPath = join(dir, "calls.jsonl");
  const calls = existsSync(callsPath) ? readFileSync(callsPath, "utf8").trim().split("\n").map(JSON.parse) : [];
  const stored = existsSync(join(dir, "stored.json")) ? JSON.parse(readFileSync(join(dir, "stored.json"), "utf8")) : null;
  return { ...r, calls, stored, out: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}
const mutations = (r) => r.calls.filter(a => a[0] === "issues" && ["create", "update"].includes(a[1]));

describe("ask create label application", () => {
  test("files with both workspace-only label IDs", () => {
    const r = runAsk({ team: [], workspace: labels("workspace") });
    expect(r.status).toBe(0);
    expect(r.stored.labels).toEqual(["workspace-0", "workspace-1"]);
    expect(r.calls.slice(0, 2)).toEqual([teamArgs, workspaceArgs]);
  });
  test("files with the team's decision label and workspace ask label", () => {
    const r = runAsk({ team: [labels("team")[1]], workspace: labels("workspace") });
    expect(r.status).toBe(0);
    expect(r.stored.labels).toEqual(["workspace-0", "team-1"]);
  });
  test("lookup failures make no issue mutations", () => {
    for (const config of [{ team: [] }, { labelFailure: "team" }, { team: [], labelFailure: "workspace" },
      { team: [...labels("team"), { id: "other", name: NAMES[0] }] }]) {
      const r = runAsk(config);
      expect(r.status).toBe(1);
      expect(mutations(r)).toEqual([]);
    }
  });
  test("dry-run resolves workspace labels without issue mutations", () => {
    const r = runAsk({ team: [], workspace: labels("workspace") }, { extra: ["--dry-run"] });
    expect(r.status).toBe(0);
    expect(r.out.labelIds).toEqual(["workspace-0", "workspace-1"]);
    expect(r.calls).toEqual([teamArgs, workspaceArgs]);
  });
});

const edge = (identifier) => ({ type: "blocks", relatedIssue: { identifier } });
function expectBody(r) {
  expect(r.out).toMatchObject({ decidable: true, reason: null, parsedOptions: ["Wait", "Release"],
    factsVerified: true, factsReason: null, parsedFacts: [{ label: "Owner", value: "Release team" }] });
}

describe("ask create final relation evidence", () => {
  test("partial relations report the exact missing IDs despite all IDs in the body", () => {
    const r = runAsk({ relationFields: { relations: { nodes: [edge(BLOCKS[2])] } } }, { blocks: BLOCKS });
    expect(r.status).toBe(2);
    expect(r.out).toMatchObject({ blocksVerified: false, missingBlocks: BLOCKS.slice(0, 2) });
    expect(r.stored.description).toContain(`Blocks: ${BLOCKS.join(", ")}`);
    expect(r.stderr).toContain(`relations are NOT on it: ${BLOCKS.slice(0, 2).join(", ")}`);
    expect(r.stderr).not.toContain("NO relation field");
    expectBody(r);
  });
  test("complete outgoing arrays and nodes wrappers verify", () => {
    for (const relations of [BLOCKS.map(edge), { nodes: BLOCKS.map(edge) }]) {
      const r = runAsk({ relationFields: { relations } }, { blocks: BLOCKS });
      expect(r.status).toBe(0);
      expect(r.out).toMatchObject({ blocksVerified: true, missingBlocks: [] });
      expectBody(r);
    }
  });
  test("explicit empty relations report every target missing", () => {
    for (const relations of [[], { nodes: [] }]) {
      const r = runAsk({ relationFields: { relations } }, { blocks: BLOCKS });
      expect(r.status).toBe(2);
      expect(r.out).toMatchObject({ blocksVerified: false, missingBlocks: BLOCKS });
      expect(r.stderr).toContain("relations are NOT on it");
      expect(r.stderr).not.toContain("NO relation field");
      expectBody(r);
    }
  });
  test("absent or malformed relation containers remain unknown", () => {
    for (const relationFields of [{}, { relations: null }, { relations: { nodes: "bad" }, inverseRelations: {} }]) {
      const r = runAsk({ relationFields }, { blocks: BLOCKS });
      expect(r.status).toBe(2);
      expect(r.out).toMatchObject({ blocksVerified: false, missingBlocks: [] });
      expect(r.stderr).toContain("NO relation field");
      expect(r.stderr).not.toContain("relations are NOT on it");
      expectBody(r);
    }
  });
  test("inverse blocked_by edges verify in both supported wrappers", () => {
    const edges = BLOCKS.map(identifier => ({ type: "blocked_by", issue: { identifier } }));
    for (const inverseRelations of [edges, { nodes: edges }]) {
      const r = runAsk({ relationFields: { inverseRelations } }, { blocks: BLOCKS });
      expect(r.status).toBe(0);
      expect(r.out).toMatchObject({ blocksVerified: true, missingBlocks: [] });
    }
  });
  test("incoming blocks and unrelated edges cannot satisfy outgoing targets", () => {
    const r = runAsk({ relationFields: { inverseRelations: BLOCKS.map(edge),
      relations: BLOCKS.map(identifier => ({ type: "relates_to", relatedIssue: { identifier } })) } }, { blocks: BLOCKS });
    expect(r.status).toBe(2);
    expect(r.out).toMatchObject({ blocksVerified: false, missingBlocks: BLOCKS });
  });
  test("complete relations do not hide a defective body", () => {
    const r = runAsk({ storedBody: "Options were lost", relationFields: { relations: BLOCKS.map(edge) } }, { blocks: BLOCKS });
    expect(r.status).toBe(2);
    expect(r.out).toMatchObject({ decidable: false, reason: "options-unreadable", blocksVerified: true });
  });
});

const issueCalls = (r) => r.calls.filter(a => a[0] === "issues");
describe("ask create persists each block", () => {
  test("all three blocks persist with scalar options before one final read", () => {
    const r = runAsk({}, { blocks: BLOCKS });
    expect(r.status).toBe(0);
    expect(r.stored.blocks).toEqual(BLOCKS);
    expect(r.out).toMatchObject({ blocksVerified: true, missingBlocks: [] });
    expectBody(r);
    const calls = issueCalls(r);
    expect(calls.map(a => a[1])).toEqual(["create", "update", "update", "read"]);
    expect(calls[0].filter(a => a === "--blocks")).toHaveLength(1);
    expect(calls[0].slice(-2)).toEqual(["--blocks", BLOCKS[0]]);
    expect(calls.slice(1)).toEqual([
      ["issues", "update", "CTC-9000", "--blocks", BLOCKS[1]],
      ["issues", "update", "CTC-9000", "--blocks", BLOCKS[2]],
      ["issues", "read", "CTC-9000"],
    ]);
  });
  test("one target needs no updates", () => {
    const r = runAsk();
    expect(r.status).toBe(0);
    expect(r.stored.blocks).toEqual([BLOCKS[0]]);
    expect(issueCalls(r).map(a => a[1])).toEqual(["create", "read"]);
  });
  test("duplicate targets are written once in first-occurrence order", () => {
    const r = runAsk({}, { blocks: [BLOCKS[1], BLOCKS[0], BLOCKS[1], BLOCKS[2], BLOCKS[0]] });
    expect(r.status).toBe(0);
    expect(r.stored.blocks).toEqual([BLOCKS[1], BLOCKS[0], BLOCKS[2]]);
    expect(r.stored.description).toContain(`Blocks: ${[BLOCKS[1], BLOCKS[0], BLOCKS[2]].join(", ")}`);
    expect(mutations(r)).toHaveLength(3);
  });
  test("a failed update does not prevent later updates or final verification", () => {
    const r = runAsk({ failUpdates: [BLOCKS[1]] }, { blocks: BLOCKS });
    expect(r.status).toBe(2);
    expect(r.stored.blocks).toEqual([BLOCKS[0], BLOCKS[2]]);
    expect(r.out).toMatchObject({ blocksVerified: false, missingBlocks: [BLOCKS[1]] });
    expect(issueCalls(r).map(a => a[1])).toEqual(["create", "update", "update", "read"]);
    expect(r.stderr).toContain(`--blocks ${BLOCKS[1]}`);
    expect(r.stderr).toContain("update rejected");
    expect(r.stderr).not.toContain("x".repeat(401));
  });
  test("successful mutations that omit two edges still report exactly those edges missing", () => {
    const r = runAsk({ omit: BLOCKS.slice(0, 2) }, { blocks: BLOCKS });
    expect(r.status).toBe(2);
    expect(r.stored.blocks).toEqual([BLOCKS[2]]);
    expect(r.out).toMatchObject({ blocksVerified: false, missingBlocks: BLOCKS.slice(0, 2) });
    expect(issueCalls(r).map(a => a[1])).toEqual(["create", "update", "update", "read"]);
    expect(r.stderr).not.toContain("NO relation field");
    expectBody(r);
  });
  test("a failed command that persisted its edge can verify from final state", () => {
    const r = runAsk({ failUpdates: [BLOCKS[1]], persistFailedUpdate: true }, { blocks: BLOCKS });
    expect(r.status).toBe(0);
    expect(r.stored.blocks).toEqual(BLOCKS);
    expect(r.out).toMatchObject({ blocksVerified: true, missingBlocks: [] });
    expect(r.stderr).toContain(`--blocks ${BLOCKS[1]}`);
    expect(r.stderr).toContain("update rejected");
  });
  test("failed or malformed reads cannot report success or retry creation", () => {
    for (const config of [{ readFailure: true }, { readMalformed: true }]) {
      const r = runAsk(config, { blocks: BLOCKS });
      expect(r.status).not.toBe(0);
      expect(r.out).toBeNull();
      expect(issueCalls(r).map(a => a[1])).toEqual(["create", "update", "update", "read"]);
    }
  });
  test("failed creation or a wrong-team identifier prevents later updates", () => {
    for (const config of [{ createFailure: true }, { identifier: "OTHER-9000" }, { identifier: "unreadable" }]) {
      const r = runAsk(config, { blocks: BLOCKS });
      expect(r.status).not.toBe(0);
      expect(issueCalls(r).map(a => a[1])).toEqual(["create"]);
    }
  });
  test("a dry-run with several targets has no issue mutations", () => {
    const r = runAsk({}, { blocks: BLOCKS, extra: ["--dry-run"] });
    expect(r.status).toBe(0);
    expect(issueCalls(r)).toEqual([]);
    expect(r.out.body).toContain(`Blocks: ${BLOCKS.join(", ")}`);
  });
});
