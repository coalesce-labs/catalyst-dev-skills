// review-and-verify.test.mjs — the depth a review runs at, and the result example the skill shows.
//
// Run: bun test tests/review-and-verify.test.mjs
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_ONE_WAY_PATHS,
  declaredOneWayPaths,
  reviewDepth,
} from "../skills/review-and-verify/scripts/review-depth.mjs";

const skill = resolve(import.meta.dir, "../skills/review-and-verify");

describe("declaredOneWayPaths reads [review] one_way_paths from a settings file", () => {
  test("literal and basic strings, comments and a trailing comma, in the review table only", () => {
    const toml = [
      "[project]",
      'name = "x"',
      "",
      "[review]",
      "# one-way doors",
      "one_way_paths = [",
      "  '^db/migrations/', # sql",
      '  "^apps/a\\\\.toml$",',
      "]",
      "",
      "[environment]",
      "one_way_paths = ['not-this-table']",
    ].join("\n");
    expect(declaredOneWayPaths(toml)).toEqual(["^db/migrations/", "^apps/a\\.toml$"]);
  });

  test("an absent key is undefined, so the default list applies", () => {
    expect(declaredOneWayPaths("[review]\nother = 1\n")).toBeUndefined();
    expect(declaredOneWayPaths("[environment]\none_way_paths = ['x']\n")).toBeUndefined();
  });

  test("a value that is not an array of single-line strings throws", () => {
    expect(() => declaredOneWayPaths("[review]\none_way_paths = '^x/'\n")).toThrow();
    expect(() => declaredOneWayPaths("[review]\none_way_paths = [1]\n")).toThrow();
    expect(() => declaredOneWayPaths("[review]\none_way_paths = ['^x/'\n")).toThrow();
  });
});

describe("reviewDepth", () => {
  test("a change touching a one-way path is deep and names the match", () => {
    const r = reviewDepth(["src/a.ts", "db/migrations/0042.sql"], DEFAULT_ONE_WAY_PATHS, "default");
    expect(r.depth).toBe("deep");
    expect(r.matches).toEqual([{ path: "db/migrations/0042.sql", pattern: "(?:^|/)migrations?/" }]);
  });

  test("a change touching none is light", () => {
    expect(reviewDepth(["src/a.ts", "README.md"], DEFAULT_ONE_WAY_PATHS, "default").depth).toBe("light");
  });

  test("an empty change list fails closed to deep", () => {
    expect(reviewDepth([], DEFAULT_ONE_WAY_PATHS, "default").depth).toBe("deep");
  });

  test("a declaration replaces the default list", () => {
    expect(reviewDepth([".github/workflows/ci.yml"], ["^db/"], "declared").depth).toBe("light");
  });
});

describe("the result example in references/result-schema.md", () => {
  const md = readFileSync(resolve(skill, "references/result-schema.md"), "utf8");
  const block = md.match(/```json\n([\s\S]*?)\n```/);
  const doc = JSON.parse(block[1]);

  test("its summary matches its findings", () => {
    const count = (...v) => doc.findings.filter((f) => v.includes(f.verdict)).length;
    expect(doc.summary).toEqual({
      found: doc.findings.length,
      fixed: count("valid"),
      invalid: count("invalid", "already-fixed"),
      deferred: count("deferred"),
      needs_human: count("needs-human"),
    });
  });

  test("every sha is a full lowercase sha and every valid finding names its fix", () => {
    const shas = [doc.reviewed_head, doc.final_head, doc.base, ...doc.findings.flatMap((f) => (f.fix ? [f.fix.sha] : []))];
    for (const sha of shas) expect(sha).toMatch(/^[0-9a-f]{40}$/);
    for (const f of doc.findings.filter((f) => f.verdict === "valid")) expect(f.fix.files).toContain(f.path);
    for (const f of doc.findings.filter((f) => f.verdict !== "valid")) expect(f.reason).toBeTruthy();
  });

  test("a deep example names its reason and a second opinion", () => {
    expect(doc.depth).toBe("deep");
    expect(doc.depth_reason.length).toBeGreaterThan(0);
    expect(doc.models.map((m) => m.role)).toContain("second-opinion");
    expect(doc.merge).toEqual({ auto: true });
  });
});
