// skill-scope.test.mjs — every skill installs to exactly one scope, and that scope is home.
// CTC-2558.
//
// Run: bun test tests/skill-scope.test.mjs

import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCOPES,
  documentedInstallProblems,
  observeInstall,
  ownershipProblems,
  readOwnership,
  repositoryResidue,
  scopeViolations,
  validateOwnership,
} from "../scripts/check-skill-scope.mjs";
import { skillNames } from "../scripts/check-name-collisions.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "skill-scope-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** installTree(root, agentDirs, names) — writes <root>/<agentDir>/skills/<name>/SKILL.md for
 * every combination, mirroring the shape the real `skills` CLI writes. */
function installTree(root, agentDirs, names) {
  for (const a of agentDirs) {
    for (const n of names) {
      mkdirSync(join(root, a, "skills", n), { recursive: true });
      writeFileSync(join(root, a, "skills", n, "SKILL.md"), `---\nname: ${n}\ndescription: d\n---\n`);
    }
  }
}

describe("ownership manifest", () => {
  test("every skill in this repository is owned, at home scope", () => {
    const declared = readOwnership(repoRoot).skills;
    const actual = skillNames(repoRoot);
    expect(declared.length).toBe(35);
    expect(actual.length).toBe(35);
    expect(declared.every((s) => s.scope === "home")).toBe(true);
    expect(declared.find((s) => s.dir === "linearis")?.name).toBe("linearis-cli");
    expect(ownershipProblems(declared, actual)).toEqual([]);
    expect(declared.map((s) => s.dir)).toEqual([...declared.map((s) => s.dir)].sort());
  });

  test("control: a skill with no manifest entry is reported", () => {
    const declared = [{ dir: "commit", name: "commit", scope: "home" }];
    const actual = [{ dir: "commit", name: "commit" }, { dir: "unslop", name: "unslop" }];
    const problems = ownershipProblems(declared, actual);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toContain("skills/unslop is not in packs/skills-ownership.json");
  });

  test("control: a manifest entry with no skill directory is reported", () => {
    const declared = [{ dir: "ghost", name: "ghost", scope: "home" }];
    const actual = [{ dir: "commit", name: "commit" }];
    const problems = ownershipProblems(declared, actual);
    expect(problems.join("\n")).toContain('names "ghost", which has no skills/ghost');
  });

  test("control: a manifest name that disagrees with frontmatter is reported", () => {
    const declared = [{ dir: "linearis", name: "linearis", scope: "home" }];
    const actual = [{ dir: "linearis", name: "linearis-cli" }];
    const problems = ownershipProblems(declared, actual);
    expect(problems.join("\n")).toContain('gives skills/linearis the name "linearis"');
    expect(problems.join("\n")).toContain('frontmatter name is "linearis-cli"');
  });

  test("control: an unknown scope value is rejected, naming the accepted values", () => {
    const parsed = { version: 1, skills: [{ dir: "commit", name: "commit", scope: "project" }] };
    expect(() => validateOwnership(parsed, "test")).toThrow(/accepted values are/);
    expect(() => validateOwnership(parsed, "test")).toThrow(/home/);
  });

  test("control: a skill declared repository-scope is rejected (CTC-2558)", () => {
    // "repository" is a syntactically valid scope (SCOPES has it) so validateOwnership accepts
    // it — the general comparison logic must stay honestly testable in both directions — but
    // ownershipProblems, which encodes the ticket's actual decision, flags it.
    expect(SCOPES.has("repository")).toBe(true);
    const declared = validateOwnership(
      { version: 1, skills: [{ dir: "commit", name: "commit", scope: "repository" }] },
      "test",
    ).skills;
    const actual = [{ dir: "commit", name: "commit" }];
    const problems = ownershipProblems(declared, actual);
    expect(problems.join("\n")).toContain('declares skills/commit "repository"-scoped');
    expect(problems.join("\n")).toContain("CTC-2558");
  });

  test("control: a duplicate dir, an unknown key, and a non-array skills value each throw", () => {
    expect(() =>
      validateOwnership(
        { version: 1, skills: [{ dir: "a", name: "a", scope: "home" }, { dir: "a", name: "b", scope: "home" }] },
        "test",
      ),
    ).toThrow(/duplicate dir "a"/);
    expect(() => validateOwnership({ version: 1, skills: [], extra: true }, "test")).toThrow(/unknown key "extra"/);
    expect(() => validateOwnership({ version: 1, skills: "nope" }, "test")).toThrow(/"skills" must be a list/);
  });
});

describe("install scope guard", () => {
  const declared = [{ dir: "commit", name: "commit", scope: "home" }];

  test("a correct home-scope install is clean", () => {
    const home = join(scratch, "ok-home");
    const repo = join(scratch, "ok-repo");
    installTree(home, [".claude", ".agents", ".config/goose"], ["commit"]);
    mkdirSync(join(repo, ".git"), { recursive: true }); // a repository, with no install in it
    expect(scopeViolations(declared, { home, repository: repo })).toEqual([]);
  });

  // ── THE NEGATIVE CONTROL the ticket asks for ──────────────────────────────────────────────
  // A home-declared skill installed into a repository scope. An inert guard (e.g. one that
  // always returns []) would pass this test; that is exactly what it exists to catch.
  test("negative control: a home-scoped skill installed into a repository scope fails the guard", () => {
    const home = join(scratch, "neg-home");
    const repo = join(scratch, "neg-repo");
    installTree(home, [".claude", ".agents"], ["commit"]);
    installTree(repo, [".claude", ".agents", "agent"], ["commit"]); // exactly what `--all` without -g writes
    writeFileSync(join(repo, "skills-lock.json"), '{"version":1,"skills":{"commit":{}}}');
    const problems = scopeViolations(declared, { home, repository: repo });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toContain("commit");
    // Every repository copy is named, not just whichever one readdirSync enumerated last: a
    // version of this guard that kept one path per skill name reported exactly one of these
    // three, and which one depended on filesystem enumeration order.
    for (const agentDir of [".agents", ".claude", "agent"]) {
      expect(problems.join("\n")).toContain(join(repo, agentDir, "skills", "commit"));
    }
    expect(problems.join("\n")).toContain(join(repo, "skills-lock.json"));
  });

  test("every repository copy is reported, in a filesystem-order-independent order", () => {
    const home = join(scratch, "all-copies-home");
    const repo = join(scratch, "all-copies-repo");
    installTree(home, [".claude"], ["commit"]);
    // `zz` sorts last and `.agents` first, so an assertion on "the last one enumerated" would
    // name a different path on a filesystem that enumerates in a different order.
    installTree(repo, ["zz", ".agents", "mid"], ["commit"]);
    const reported = scopeViolations(declared, { home, repository: repo })
      .filter((p) => p.includes("a repository copy is at"))
      .map((p) => p.slice(p.indexOf(repo)));
    expect(reported).toEqual([
      join(repo, ".agents", "skills", "commit"),
      join(repo, "mid", "skills", "commit"),
      join(repo, "zz", "skills", "commit"),
    ]);
  });

  test("control: a home-declared skill missing from the home scope is reported", () => {
    const home = join(scratch, "missing-home");
    const repo = join(scratch, "missing-repo");
    mkdirSync(home, { recursive: true });
    mkdirSync(join(repo, ".git"), { recursive: true });
    const problems = scopeViolations(declared, { home, repository: repo });
    expect(problems.join("\n")).toContain("no copy was installed under $HOME");
  });

  test("observeInstall finds every agent root shape the CLI writes, at any nesting", () => {
    const root = join(scratch, "multi-root");
    installTree(root, [".claude", ".agents", "agent", ".config/goose", ".pi/agent"], ["commit"]);
    const found = observeInstall(root);
    expect(found.length).toBe(5);
    expect(found.every((s) => s.name === "commit")).toBe(true);
  });

  test("observeInstall does not mistake a repository's own skills/ source tree for an install", () => {
    const root = join(scratch, "source-tree");
    mkdirSync(join(root, "skills", "commit"), { recursive: true });
    writeFileSync(join(root, "skills", "commit", "SKILL.md"), "---\nname: commit\ndescription: d\n---\n");
    expect(observeInstall(root)).toEqual([]);
  });

  test("this checkout carries no repository-scoped install", () => {
    expect(repositoryResidue(repoRoot)).toEqual([]);
  });
});

describe("the real-CLI negative control asserts on the violation itself", () => {
  test("install-scope-smoke.sh greps for the violation text, not a word the summary always prints", () => {
    const smoke = readFileSync(join(repoRoot, "scripts", "install-scope-smoke.sh"), "utf8");
    // The negative control's own condition line, not the whole file (whose comments discuss the
    // weaker grep this replaced). Grepping the word "repository" matched the guard's
    // always-printed summary line ("… 0 repository-scoped; N problem(s)"), so the step passed on
    // a run in which no repository copy was detected at all.
    const condition = smoke.split("\n").find((l) => l.startsWith('if [ "$rc" -ne 0 ]'));
    expect(condition).toBeDefined();
    expect(condition).toContain('grep -q "a repository copy is at"');
  });

  test("the grepped text appears only when a repository copy really exists", () => {
    const declared = [{ dir: "commit", name: "commit", scope: "home" }];
    const home = join(scratch, "neg-token-home");
    const repo = join(scratch, "neg-token-repo");
    mkdirSync(home, { recursive: true });
    mkdirSync(join(repo, ".git"), { recursive: true });
    // An empty home/empty repo pair: the guard fails (nothing is installed under $HOME) but it
    // found no repository copy, so the token the smoke script asserts on must be absent.
    const problems = scopeViolations(declared, { home, repository: repo }).join("\n");
    expect(problems).toContain("no copy was installed under $HOME");
    expect(problems).not.toContain("a repository copy is at");
  });
});

describe("the guard is wired where the ticket says", () => {
  test("package.json exposes test:guards and it runs the scope guard", () => {
    const scripts = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts;
    expect(scripts["test:guards"]).toBeDefined();
    expect(scripts["test:guards"]).toContain("check-skill-scope.mjs");
    expect(scripts["test:guards"]).toContain("tests/skill-scope.test.mjs");
  });

  test("CI runs test:guards", () => {
    expect(readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8")).toContain("run test:guards");
  });
});

describe("the documented install is home-scoped", () => {
  test("every documented `npx skills` command carries -g", () => {
    expect(documentedInstallProblems(repoRoot)).toEqual([]);
  });

  test("control: a command without -g is reported, naming the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-install-"));
    mkdirSync(join(dir, ".agents"), { recursive: true });
    writeFileSync(join(dir, ".agents", "install-block.md"), "```sh\nnpx skills@latest add owner/pack --all\n```\n");
    writeFileSync(join(dir, "README.md"), "```sh\nnpx skills@latest add owner/pack --all -g\n```\n");
    const problems = documentedInstallProblems(dir);
    expect(problems.join("\n")).toContain(".agents/install-block.md");
    expect(problems.join("\n")).toContain("-g/--global");
    rmSync(dir, { recursive: true, force: true });
  });

  test("README carries the canonical block's add command verbatim", () => {
    const canonical = readFileSync(join(repoRoot, ".agents", "install-block.md"), "utf8");
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    const addLine = canonical.split("\n").find((l) => /^npx skills@\S+ add /.test(l.trim()));
    expect(addLine).toBeDefined();
    expect(readme).toContain(addLine.trim());
  });

  test("control: an UNPINNED command without -g is reported (not only `skills@<version>` ones)", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-install-unpinned-"));
    mkdirSync(join(dir, ".agents"), { recursive: true });
    // `npx skills update -y` — no version pin, no -g. This is the exact form this repository
    // documented before CTC-2558, so it is the regression the guard most needs to see.
    const docs = "```sh\nnpx skills@latest add owner/pack --all -g\n```\n\n```sh\nnpx skills update -y\n```\n";
    writeFileSync(join(dir, ".agents", "install-block.md"), docs);
    writeFileSync(join(dir, "README.md"), docs);
    const problems = documentedInstallProblems(dir);
    expect(problems.join("\n")).toContain("npx skills update -y");
    expect(problems.join("\n")).toContain("-g/--global");
    // both files are checked, so the unpinned line is reported once for each
    expect(problems.filter((p) => p.includes("npx skills update -y")).length).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  test("control: a README that has drifted from the canonical block is reported", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-install-drift-"));
    mkdirSync(join(dir, ".agents"), { recursive: true });
    writeFileSync(join(dir, ".agents", "install-block.md"), "```sh\nnpx skills@latest add owner/pack --all -g\n```\n");
    writeFileSync(join(dir, "README.md"), "```sh\nnpx skills@latest add owner/pack --all -g -y\n```\n");
    const problems = documentedInstallProblems(dir);
    expect(problems.join("\n")).toContain("verbatim");
    rmSync(dir, { recursive: true, force: true });
  });
});
