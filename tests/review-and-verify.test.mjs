// review-and-verify.test.mjs — the depth a review runs at, and the result example the skill shows.
//
// Run: bun test tests/review-and-verify.test.mjs
import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  DEFAULT_ONE_WAY_PATHS,
  checkDeclaredOneWayPaths,
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

describe("checkDeclaredOneWayPaths refuses a declaration the cloud would refuse", () => {
  test("an empty list, a repeat, an empty or overlong entry and a bad pattern throw", () => {
    expect(() => checkDeclaredOneWayPaths([])).toThrow();
    expect(() => checkDeclaredOneWayPaths(["^db/", "^db/"])).toThrow();
    expect(() => checkDeclaredOneWayPaths([""])).toThrow();
    expect(() => checkDeclaredOneWayPaths(["a".repeat(2049)])).toThrow();
    expect(() => checkDeclaredOneWayPaths(Array.from({ length: 33 }, (_, i) => `^p${i}/`))).toThrow();
    expect(() => checkDeclaredOneWayPaths(["(unclosed"])).toThrow();
  });

  test("1 to 32 unique valid entries pass", () => {
    expect(() => checkDeclaredOneWayPaths(["^db/migrations/"])).not.toThrow();
    expect(() => checkDeclaredOneWayPaths(Array.from({ length: 32 }, (_, i) => `^p${i}/`))).not.toThrow();
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

describe("the script chooses from the list at the base", () => {
  const SCRIPT = resolve(skill, "scripts/review-depth.mjs");
  const SETTINGS = ".catalyst/catalyst.toml";
  const NOTHING = "[review]\none_way_paths = ['^nothing$']\n";
  const git = (repo, ...args) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const commit = (repo, files) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
    git(repo, "add", "-A");
    git(repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "x");
    return git(repo, "rev-parse", "HEAD");
  };
  // A base holding baseFiles and a head that adds headFiles, then the script's own output.
  const chosen = (baseFiles, headFiles) => {
    const repo = mkdtempSync(join(tmpdir(), "review-depth-"));
    try {
      git(repo, "init", "-q");
      const base = commit(repo, { "README.md": "x\n", ...baseFiles });
      const head = commit(repo, headFiles);
      const run = spawnSync("node", [SCRIPT, "--base", base, "--head", head], { cwd: repo, encoding: "utf8" });
      return { status: run.status, depth: /^depth: (.*)$/m.exec(run.stdout)?.[1], source: /^source: (.*)$/m.exec(run.stdout)?.[1] ?? "" };
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  };

  test("a pull request that adds a list matching nothing stays deep on auth code", () => {
    const r = chosen({}, { [SETTINGS]: NOTHING, "src/auth/login.ts": "x\n" });
    expect(r).toMatchObject({ status: 0, depth: "deep" });
    expect(r.source).toContain("at the base");
  });

  test("a pull request that narrows the base's list is still judged by the base's list", () => {
    const list = "[review]\none_way_paths = ['^src/secure/']\n";
    const r = chosen({ [SETTINGS]: list }, { [SETTINGS]: NOTHING, "src/secure/a.ts": "x\n" });
    expect(r.depth).toBe("deep");
    expect(r.source).toContain(`${SETTINGS} [review] one_way_paths at the base`);
  });

  test("a pull request that widens the list is judged by the base's list too", () => {
    const list = "[review]\none_way_paths = ['^db/']\n";
    const r = chosen({ [SETTINGS]: list }, { [SETTINGS]: "[review]\none_way_paths = ['^src/']\n", "src/a.ts": "x\n" });
    expect(r.depth).toBe("light");
  });

  test("a list the pull request breaks does not change the depth the base gives", () => {
    const list = "[review]\none_way_paths = ['^db/']\n";
    expect(chosen({ [SETTINGS]: list }, { [SETTINGS]: "[review\n", "src/a.ts": "x\n" }).depth).toBe("light");
  });

  test.each([
    ["a dotted key", "review.one_way_paths = ['^nothing$']\n", "dotted key"],
    ["a quoted dotted key", "\"review\".\"one_way_paths\" = ['^nothing$']\n", "dotted key"],
    ["an inline table", "review = { one_way_paths = ['^nothing$'] }\n", "inline table"],
    ["a repeated table", "[review]\nother = 1\n\n[review]\none_way_paths = ['^nothing$']\n", "repeats"],
    ["an array of tables", "[[review]]\none_way_paths = ['^nothing$']\n", "array of tables"],
    ["a quoted table name", "[\"review\"]\none_way_paths = ['^nothing$']\n", "quotes"],
    ["a quoted key", "[review]\n\"one_way_paths\" = ['^nothing$']\n", "quotes"],
    ["the list as a table", "[review.one_way_paths]\nx = 1\n", "as a table"],
  ])("%s at the base is deep and says it could not be read", (_name, toml, reason) => {
    const r = chosen({ [SETTINGS]: toml }, { "src/a.ts": "x\n" });
    expect(r).toMatchObject({ status: 0, depth: "deep" });
    expect(r.source).toContain("could not be read");
    expect(r.source).toContain(reason);
  });

  test.each([
    ["no settings file", {}],
    ["a settings file with no review table", { [SETTINGS]: "[other]\nname = 1\n" }],
    ["the key under another table", { [SETTINGS]: "[environment]\none_way_paths = ['x']\n" }],
    ["another key under a review subtable", { [SETTINGS]: "[review.extra]\nname = 1\n" }],
    ["a comment that names a dotted key", { [SETTINGS]: "# review.one_way_paths = ['x']\n" }],
    ["a review key under another table", { [SETTINGS]: "[other]\nreview = 1\n" }],
  ])("%s falls to the default list", (_name, baseFiles) => {
    const r = chosen(baseFiles, { "src/a.ts": "x\n" });
    expect(r.depth).toBe("light");
    expect(r.source).toContain("default list");
    expect(chosen(baseFiles, { "src/auth/a.ts": "x\n" }).depth).toBe("deep");
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
