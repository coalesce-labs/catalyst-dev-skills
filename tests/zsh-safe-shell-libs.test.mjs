// zsh-safe-shell-libs.test.mjs — our shell libraries are sourced into zsh (Claude Code's default
// shell) as well as bash. CTC-4188.
//
// Run: bun test tests/zsh-safe-shell-libs.test.mjs
//
// zsh ties some lower-case names to special parameters: `path` is the array behind PATH, so
// `local path; path=...` inside a sourced function empties PATH for the rest of that function, and
// `status` is read-only, so `local status=...` is an error. On 2026-09-28 that made
// handoff_sync_and_classify report `local-only:sync-unavailable` ("needs jq or node") on a machine
// that had both, because catalyst_thoughts_repo assigned `path`. Under bash the same call synced.

import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// zsh special parameters a script might plausibly use as an ordinary variable name.
export const ZSH_SPECIAL = [
  "path", "status", "argv", "pipestatus", "fpath", "cdpath", "manpath", "mailpath", "module_path",
  "options", "commands", "functions", "aliases", "parameters", "signals", "history", "histchars",
  "prompt", "psvar", "dirstack", "userdirs", "nameddirs", "modules", "builtins", "reswords",
  "jobtexts", "jobstates", "jobdirs", "funcstack", "widgets", "keymaps", "errnos", "sysparams",
];

/** Every place a shell source declares, assigns or `read`s into a zsh special name. */
export function zshSpecialUses(source) {
  const names = ZSH_SPECIAL.join("|");
  const hits = [];
  source.split("\n").forEach((raw, i) => {
    if (raw.trimStart().startsWith("#")) return;
    const line = raw.replace(/\s#.*$/, "");
    const decl = line.match(/^\s*(?:local|declare|typeset|readonly)\b(.*)$/);
    if (decl) {
      for (const m of decl[1].matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)(?==|\s|$)/g)) {
        if (ZSH_SPECIAL.includes(m[1])) hits.push({ line: i + 1, name: m[1] });
      }
    }
    for (const m of line.matchAll(new RegExp(`(?:^|[;&|(]\\s*|\\b(?:then|do)\\s+)\\s*(${names})\\+?=`, "g"))) {
      hits.push({ line: i + 1, name: m[1] });
    }
    for (const m of line.matchAll(/\bread\s+((?:-\w+\s+(?:'[^']*'\s+)?)*)([A-Za-z_][\w\s]*?)(?=\s*(?:;|<|\||&|$))/g)) {
      for (const v of m[2].split(/\s+/)) if (ZSH_SPECIAL.includes(v)) hits.push({ line: i + 1, name: v });
    }
    for (const m of line.matchAll(new RegExp(`\\bfor\\s+(${names})\\s+in\\b`, "g"))) {
      hits.push({ line: i + 1, name: m[1] });
    }
  });
  return hits;
}

function shellFiles() {
  const r = spawnSync("git", ["ls-files", "*.sh"], { cwd: repoRoot, encoding: "utf8" });
  // A tracked file deleted in the working tree is not a shell source any more.
  return r.stdout.split("\n").filter(Boolean).filter((f) => existsSync(join(repoRoot, f)));
}

describe("zshSpecialUses", () => {
  test("POSITIVE CONTROL: finds the shapes that broke, and leaves safe names alone", () => {
    const planted = [
      'f() {',
      '  local org="${1:-}" path rc root',
      '  path="$(catalyst_path thoughtsRepo)"',
      '  local status="$1" reason="$2"',
      "  while IFS=$'\\t' read -r name path; do :; done",
      '  local repo_path; repo_path=x  # path in a comment is fine',
      '  echo "the path is $repo_path"',
      '}',
    ].join("\n");
    expect(zshSpecialUses(planted).map((h) => `${h.line}:${h.name}`)).toEqual([
      "2:path", "3:path", "4:status", "5:path",
    ]);
  });
});

describe("shell sources are zsh-safe (CTC-4188)", () => {
  test("no shell file declares, assigns or reads into a zsh special parameter", () => {
    const found = [];
    for (const f of shellFiles()) {
      for (const h of zshSpecialUses(readFileSync(join(repoRoot, f), "utf8"))) {
        found.push(`${f}:${h.line} ${h.name}`);
      }
    }
    expect(found).toEqual([]);
  });
});

const zsh = spawnSync("zsh", ["-c", "true"]).status === 0;

/** The paths file is the source under test, so no environment override may shadow it. */
function withoutThoughtsOverride(env) {
  const { CATALYST_THOUGHTS_REPO: _unused, ...rest } = env;
  return rest;
}
describe.skipIf(!zsh)("catalyst_thoughts_repo under zsh (CTC-4188)", () => {
  test("resolves the declared thoughts repo and leaves PATH intact", () => {
    const dir = mkdtempSync(join(tmpdir(), "zsh-safe-"));
    try {
      const thoughts = join(dir, "thoughts");
      mkdirSync(thoughts);
      spawnSync("git", ["init", "-q", thoughts]);
      const paths = join(dir, "paths.json");
      const p = (s) => join(dir, s);
      writeFileSync(paths, JSON.stringify({
        version: 1,
        paths: {
          repoRoot: p("repos"), worktrees: p("wt"), logs: p("logs"), events: p("events"),
          config: p("config"), cache: p("cache"), state: p("state"), skills: p("skills"),
          thoughtsRepo: thoughts,
        },
        provenance: { thoughtsRepo: "explicit" },
      }));
      const lib = join(repoRoot, "vendor-src/scripts/lib/thoughts-location.sh");
      const script = `source "${lib}"; out="$(catalyst_thoughts_repo coalesce-labs)"; rc=$?; print -r -- "rc=$rc out=$out jq=$(command -v jq >/dev/null && echo ok)"`;
      const r = spawnSync("zsh", ["-c", script], {
        encoding: "utf8",
        env: withoutThoughtsOverride({ ...process.env, CATALYST_PATHS_FILE: paths }),
      });
      expect(r.stdout.trim()).toBe(`rc=0 out=${thoughts} jq=ok`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
