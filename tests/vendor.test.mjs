// vendor.test.mjs — one source, generated copies.
//
// Run: bun test tests/vendor.test.mjs
//
// A file two skills share keeps ONE source under vendor-src/ and each skill lists it in
// `agents/vendor.yaml`; scripts/vendor.mjs writes byte-identical copies and `--check` fails
// when a copy disagrees. These tests pin the pure half (the destination rule, the manifest
// shape, the write/drift/prune plan) plus one scratch-repo run of the write half, because
// pruning and file modes only mean something on a real disk. Ported from catalyst
// scripts/packaging/__tests__/vendor.test.mjs.

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  vendorDestination,
  validateVendorManifest,
  parseVendorYaml,
  planVendoredCopies,
  planVendoring,
  applyVendoring,
} from "../scripts/vendor.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

describe("vendorDestination", () => {
  test("a script keeps its path under the skill's scripts/", () => {
    expect(vendorDestination("scripts/lib/draft-pr.sh")).toBe("scripts/lib/draft-pr.sh");
    expect(vendorDestination("scripts/add-finding.sh")).toBe("scripts/add-finding.sh");
  });

  test("a subagent prompt lands under assets/agents/", () => {
    expect(vendorDestination("agents/codebase-locator.md")).toBe("assets/agents/codebase-locator.md");
  });

  test("a shared plugin reference lands under assets/references/ (outside the skill-shape budget of references/)", () => {
    expect(vendorDestination("references/merge-blocker-diagnosis.md")).toBe("assets/references/merge-blocker-diagnosis.md");
  });

  test("a shared plugin template lands under assets/templates/", () => {
    expect(vendorDestination("templates/briefing-frontmatter.schema.json")).toBe("assets/templates/briefing-frontmatter.schema.json");
  });

  test("anything outside scripts/, agents/*.md, references/*.md and templates/<name> is refused, naming the path", () => {
    expect(() => vendorDestination("templates/nested/CLAUDE_SNIPPET.md")).toThrow(/templates\/nested\/CLAUDE_SNIPPET\.md/);
    expect(() => vendorDestination("hooks/x.sh")).toThrow(/hooks\/x\.sh/);
    expect(() => vendorDestination("agents/nested/x.md")).toThrow(/agents\/nested\/x\.md/);
    expect(() => vendorDestination("references/nested/x.md")).toThrow(/references\/nested\/x\.md/);
    expect(() => vendorDestination("scripts/../hooks.toml")).toThrow(/\.\./);
    expect(() => vendorDestination("/etc/passwd")).toThrow();
    expect(() => vendorDestination("scripts/")).toThrow();
  });
});

describe("validateVendorManifest", () => {
  test("accepts { files: [...] } of unique, valid sources", () => {
    expect(validateVendorManifest({ files: ["scripts/a.sh", "agents/b.md"] }, "x/vendor.yaml")).toEqual({
      files: ["scripts/a.sh", "agents/b.md"],
    });
  });

  test("refuses a missing, empty, duplicated or unknown-keyed manifest, naming the file", () => {
    expect(() => validateVendorManifest(null, "x/vendor.yaml")).toThrow(/x\/vendor\.yaml/);
    expect(() => validateVendorManifest({ files: [] }, "x/vendor.yaml")).toThrow(/empty/);
    expect(() => validateVendorManifest({ files: ["scripts/a.sh", "scripts/a.sh"] }, "x/vendor.yaml")).toThrow(/duplicate/);
    expect(() => validateVendorManifest({ files: ["scripts/a.sh"], extra: 1 }, "x/vendor.yaml")).toThrow(/extra/);
    expect(() => validateVendorManifest({ files: [7] }, "x/vendor.yaml")).toThrow(/string/);
  });
});

describe("planVendoredCopies", () => {
  const entry = (overrides) => ({
    skillId: "implement-plan",
    files: ["scripts/lib/draft-pr.sh"],
    sources: { "scripts/lib/draft-pr.sh": { base64: b64("echo source\n"), mode: 0o755 } },
    current: {},
    ...overrides,
  });

  test("a missing copy is a write AND a drift entry", () => {
    const plan = planVendoredCopies([entry({ lock: ["scripts/lib/draft-pr.sh"] })]);
    expect(plan.errors).toEqual([]);
    expect(plan.writes).toEqual([
      { skillId: "implement-plan", from: "scripts/lib/draft-pr.sh", to: "scripts/lib/draft-pr.sh", base64: b64("echo source\n"), mode: 0o755 },
    ]);
    expect(plan.drift).toEqual([{ skillId: "implement-plan", from: "scripts/lib/draft-pr.sh", to: "scripts/lib/draft-pr.sh", reason: "missing" }]);
  });

  test("a byte-identical copy with the source's mode, recorded in the lock, is neither a write nor drift", () => {
    const plan = planVendoredCopies([
      entry({ current: { "scripts/lib/draft-pr.sh": { base64: b64("echo source\n"), mode: 0o755 } }, lock: ["scripts/lib/draft-pr.sh"] }),
    ]);
    expect(plan.writes).toEqual([]);
    expect(plan.drift).toEqual([]);
    expect(plan.prunes).toEqual([]);
    expect(plan.locks).toEqual([]);
  });

  // Codex review on #4133: identical bytes with a different mode (a helper made executable)
  // must not read clean — a direct `${CLAUDE_SKILL_DIR}/scripts/x.sh` run would be denied.
  test("identical bytes with a different mode is drift 'mode-differs' and a write carrying the source mode", () => {
    const plan = planVendoredCopies([
      entry({ current: { "scripts/lib/draft-pr.sh": { base64: b64("echo source\n"), mode: 0o644 } }, lock: ["scripts/lib/draft-pr.sh"] }),
    ]);
    expect(plan.drift.map((d) => d.reason)).toEqual(["mode-differs"]);
    expect(plan.writes.map((w) => w.mode)).toEqual([0o755]);
  });

  // Codex review on #4133: a copy whose entry left the manifest must be deleted, not shipped forever.
  test("a copy the lock recorded but the manifest no longer lists is pruned (drift 'undeclared') and the lock is rewritten", () => {
    const plan = planVendoredCopies([
      entry({
        current: {
          "scripts/lib/draft-pr.sh": { base64: b64("echo source\n"), mode: 0o755 },
          "scripts/old-helper.sh": { base64: b64("old\n"), mode: 0o755 },
        },
        lock: ["scripts/lib/draft-pr.sh", "scripts/old-helper.sh"],
      }),
    ]);
    expect(plan.prunes).toEqual([{ skillId: "implement-plan", to: "scripts/old-helper.sh" }]);
    expect(plan.drift).toEqual([{ skillId: "implement-plan", from: null, to: "scripts/old-helper.sh", reason: "undeclared" }]);
    expect(plan.locks).toEqual([{ skillId: "implement-plan", files: ["scripts/lib/draft-pr.sh"] }]);
  });

  test("a missing or out-of-date lock is drift 'lock-stale' and a lock write", () => {
    const plan = planVendoredCopies([entry({ current: { "scripts/lib/draft-pr.sh": { base64: b64("echo source\n"), mode: 0o755 } }, lock: null })]);
    expect(plan.drift.map((d) => d.reason)).toEqual(["lock-stale"]);
    expect(plan.locks).toEqual([{ skillId: "implement-plan", files: ["scripts/lib/draft-pr.sh"] }]);
  });

  test("a skill whose manifest is gone but whose lock remains prunes every recorded copy and drops the lock", () => {
    const plan = planVendoredCopies([
      entry({ files: [], sources: {}, current: { "assets/agents/a.md": { base64: b64("a"), mode: 0o644 } }, lock: ["assets/agents/a.md"] }),
    ]);
    expect(plan.prunes).toEqual([{ skillId: "implement-plan", to: "assets/agents/a.md" }]);
    expect(plan.locks).toEqual([{ skillId: "implement-plan", files: [] }]);
  });

  test("an edited copy is drift with reason 'differs' — the copy never wins over the source", () => {
    const plan = planVendoredCopies([
      entry({ current: { "scripts/lib/draft-pr.sh": { base64: b64("echo edited\n"), mode: 0o755 } }, lock: ["scripts/lib/draft-pr.sh"] }),
    ]);
    expect(plan.drift.map((d) => d.reason)).toEqual(["differs"]);
    expect(plan.writes[0].base64).toBe(b64("echo source\n"));
  });

  test("a listed source that does not exist is an error, never a silent skip", () => {
    const plan = planVendoredCopies([entry({ sources: { "scripts/lib/draft-pr.sh": null } })]);
    expect(plan.errors).toEqual([{ skillId: "implement-plan", from: "scripts/lib/draft-pr.sh", reason: "source-missing" }]);
    expect(plan.writes).toEqual([]);
  });

  test("an empty input set plans nothing and says so (no vacuous pass for callers that assert coverage)", () => {
    const plan = planVendoredCopies([]);
    expect(plan).toEqual({ writes: [], drift: [], errors: [], prunes: [], locks: [], skillCount: 0 });
  });
});


describe("parseVendorYaml", () => {
  test("reads the manifest shape: document marker, comments and a files block list", () => {
    const text = "---\n# a comment\nfiles:\n  - scripts/a.sh\n  - \"agents/b.md\"  # trailing\n";
    expect(parseVendorYaml(text, "x/vendor.yaml")).toEqual({ files: ["scripts/a.sh", "agents/b.md"] });
  });

  test("refuses anything else, naming the file and line", () => {
    expect(() => parseVendorYaml("files: scripts/a.sh\n", "x/vendor.yaml")).toThrow(/x\/vendor\.yaml:1/);
    expect(() => parseVendorYaml("files:\nscripts/a.sh\n", "x/vendor.yaml")).toThrow(/x\/vendor\.yaml:2/);
  });
});

describe("vendoring a real tree (scratch repo): write, then remove an entry, then change a mode", () => {
  const root = mkdtempSync(join(tmpdir(), "catalyst-dev-skills-vendor-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const skill = join(root, "skills/sample");
  mkdirSync(join(root, "vendor-src/scripts"), { recursive: true });
  mkdirSync(join(root, "vendor-src/agents"), { recursive: true });
  writeFileSync(join(root, "vendor-src/scripts/helper.sh"), "#!/usr/bin/env bash\necho helper\n");
  chmodSync(join(root, "vendor-src/scripts/helper.sh"), 0o755);
  writeFileSync(join(root, "vendor-src/agents/finder.md"), "# finder\n");
  mkdirSync(join(skill, "agents"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: sample\ndescription: d\n---\nbody\n");
  const manifest = (files) => writeFileSync(join(skill, "agents/vendor.yaml"), `files:\n${files.map((f) => `  - ${f}`).join("\n")}\n`);

  test("write creates the copies with the source mode and a lock; a second plan is clean", () => {
    manifest(["scripts/helper.sh", "agents/finder.md"]);
    applyVendoring(root);
    expect(readFileSync(join(skill, "scripts/helper.sh"), "utf8")).toContain("echo helper");
    expect(statSync(join(skill, "scripts/helper.sh")).mode & 0o777).toBe(0o755);
    expect(existsSync(join(skill, "assets/agents/finder.md"))).toBe(true);
    const again = planVendoring(root);
    expect(again.drift).toEqual([]);
    expect(again.skillCount).toBe(1);
  });

  test("removing an entry from the manifest deletes its copy on the next write", () => {
    manifest(["scripts/helper.sh"]);
    expect(planVendoring(root).drift.map((d) => d.reason)).toContain("undeclared");
    applyVendoring(root);
    expect(existsSync(join(skill, "assets/agents/finder.md"))).toBe(false);
    expect(planVendoring(root).drift).toEqual([]);
  });

  test("a copy whose mode drifted is reported and restored", () => {
    chmodSync(join(skill, "scripts/helper.sh"), 0o644);
    expect(planVendoring(root).drift.map((d) => d.reason)).toEqual(["mode-differs"]);
    applyVendoring(root);
    expect(statSync(join(skill, "scripts/helper.sh")).mode & 0o777).toBe(0o755);
  });
});

describe("this repository", () => {
  test("every vendored copy is byte-identical to its one source (run `node scripts/vendor.mjs --write`)", () => {
    const plan = planVendoring(repoRoot);
    expect(plan.errors).toEqual([]);
    expect(plan.drift).toEqual([]);
    expect(plan.skillCount).toBeGreaterThan(0);
  });

  test("the CLI's --check exits 0 here, and non-zero with an unknown argument", () => {
    const script = join(repoRoot, "scripts/vendor.mjs");
    expect(spawnSync("node", [script, "--check"], { encoding: "utf8" }).status).toBe(0);
    expect(spawnSync("node", [script, "--bogus"], { encoding: "utf8" }).status).toBe(2);
  });

  test("every file under vendor-src/ is listed by at least one skill (no orphaned source)", () => {
    const listed = new Set();
    for (const entry of spawnSync("find", [join(repoRoot, "skills"), "-path", "*/agents/vendor.yaml"], { encoding: "utf8" }).stdout.trim().split("\n")) {
      for (const f of parseVendorYaml(readFileSync(entry, "utf8"), entry).files) listed.add(f);
    }
    const sources = spawnSync("find", [join(repoRoot, "vendor-src"), "-type", "f"], { encoding: "utf8" })
      .stdout.trim()
      .split("\n")
      .map((p) => p.slice(join(repoRoot, "vendor-src").length + 1));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((s) => !listed.has(s))).toEqual([]);
  });
});
