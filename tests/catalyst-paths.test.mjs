// catalyst-paths.test.mjs — the shell and Node path resolvers agree with packages/paths (CTC-3787).
//
// Run: bun test tests/catalyst-paths.test.mjs
//
// One table drives both vendor-src/scripts/lib/catalyst-paths.sh and catalyst-paths.mjs: the
// variable wins, then the manifest, then the standard default; bad input refuses. Every case runs
// with a scratch HOME and no inherited CATALYST_* or XDG_* variable.

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { eventsDir, resolveRole } from "../vendor-src/scripts/lib/catalyst-paths.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
// Every case spawns shells; under run-tests.sh the suites run in parallel and the 5 s default is tight.
setDefaultTimeout(30000);
const SH = join(repoRoot, "vendor-src/scripts/lib/catalyst-paths.sh");
const T = mkdtempSync(join(tmpdir(), "catalyst-paths-"));
afterAll(() => rmSync(T, { recursive: true, force: true }));

const H = join(T, "home");
mkdirSync(H, { recursive: true });
const manifest = (paths, extra = {}) => ({
  version: 1,
  paths: {
    repoRoot: "/m/repos", worktrees: "/m/wt", logs: "/m/logs", events: "/m/events",
    config: "/m/config", cache: "/m/cache", state: "/m/state", skills: "/m/skills", ...paths,
  },
  provenance: {},
  ...extra,
});
let n = 0;
function file(content) {
  const f = join(T, `paths-${++n}.json`);
  writeFileSync(f, typeof content === "string" ? content : JSON.stringify(content));
  return f;
}
const implicitDir = join(T, "xdg-config");
mkdirSync(join(implicitDir, "catalyst"), { recursive: true });
writeFileSync(join(implicitDir, "catalyst/paths.json"), "{ not json");

// [name, role, env, expected] — expected is a path, "REFUSE" (shell rc 2 / Node throws) or
// "UNSET" (shell rc 3 / Node undefined). fn "events" runs catalyst_events_dir / eventsDir.
const CASES = [
  ["the variable wins", "events", { CATALYST_EVENTS_DIR: "/v/events", CATALYST_PATHS_FILE: file(manifest({})) }, "/v/events"],
  ["a relative variable refuses", "worktrees", { CATALYST_WORKTREES_DIR: "wt" }, "REFUSE"],
  ["an empty variable refuses, as packages/paths does", "worktrees", { CATALYST_WORKTREES_DIR: "" }, "REFUSE"],
  ["the named manifest is next", "worktrees", { CATALYST_PATHS_FILE: file(manifest({ worktrees: "/x/wt" })) }, "/x/wt"],
  ["an optional role the manifest declares", "thoughtsRepo", { CATALYST_PATHS_FILE: file(manifest({ thoughtsRepo: "/x/thoughts" })) }, "/x/thoughts"],
  ["an optional role nobody declares is unset", "thoughtsRepo", { CATALYST_PATHS_FILE: file(manifest({})) }, "UNSET"],
  ["replicaDb has no default", "replicaDb", {}, "UNSET"],
  ["a named manifest that is missing refuses", "events", { CATALYST_PATHS_FILE: join(T, "nope.json") }, "REFUSE"],
  ["a malformed implicit manifest refuses", "events", { XDG_CONFIG_HOME: implicitDir }, "REFUSE"],
  ["an unsupported version refuses", "events", { CATALYST_PATHS_FILE: file({ ...manifest({}), version: 99 }) }, "REFUSE"],
  ["a manifest missing a required role refuses", "events", { CATALYST_PATHS_FILE: file({ version: 1, paths: { events: "/e" }, provenance: {} }) }, "REFUSE"],
  ["a manifest with an unknown field refuses", "events", { CATALYST_PATHS_FILE: file(manifest({}, { secret: "x" })) }, "REFUSE"],
  ["a manifest holding two JSON records refuses", "events", { CATALYST_PATHS_FILE: file(JSON.stringify(manifest({})) + JSON.stringify(manifest({}))) }, "REFUSE"],
  ["a manifest path with a NUL refuses", "events", { CATALYST_PATHS_FILE: file(manifest({ events: "/e\u0000vil" })) }, "REFUSE"],
  ["a manifest with a relative path refuses", "events", { CATALYST_PATHS_FILE: file(manifest({ logs: "logs" })) }, "REFUSE"],
  ["an empty XDG_CONFIG_HOME refuses", "events", { XDG_CONFIG_HOME: "" }, "REFUSE"],
  ["default events", "events", {}, `${H}/.local/state/catalyst/events`],
  ["a bad CATALYST_HOME does not fail the events default", "events", { CATALYST_HOME: "rel" }, `${H}/.local/state/catalyst/events`],
  ["a bad CATALYST_HOME fails the worktrees default", "worktrees", { CATALYST_HOME: "rel" }, "REFUSE"],
  ["a manifest with a relative optional path refuses", "events", { CATALYST_PATHS_FILE: file(manifest({ replicaDb: "db" })) }, "REFUSE"],
  ["a manifest with provenance for an absent role refuses", "events", { CATALYST_PATHS_FILE: file(manifest({}, { provenance: { thoughtsRepo: "default" } })) }, "REFUSE"],
  ["a manifest with an unknown provenance source refuses", "events", { CATALYST_PATHS_FILE: file(manifest({}, { provenance: { events: "guessed" } })) }, "REFUSE"],
  ["a manifest with valid provenance is accepted", "events", { CATALYST_PATHS_FILE: file(manifest({}, { provenance: { events: "default", worktrees: "explicit" } })) }, "/m/events"],
  ["default events under XDG_STATE_HOME", "events", { XDG_STATE_HOME: "/s" }, "/s/catalyst/events"],
  ["default worktrees", "worktrees", {}, `${H}/catalyst/wt`],
  ["default worktrees under CATALYST_HOME", "worktrees", { CATALYST_HOME: "/c" }, "/c/wt"],
  ["default repoRoot", "repoRoot", {}, `${H}/catalyst/repos`],
  ["default state", "state", {}, `${H}/.local/state/catalyst`],
  ["default config", "config", { XDG_CONFIG_HOME: "/cfg" }, "/cfg/catalyst"],
  ["default cache", "cache", {}, `${H}/.cache/catalyst`],
  ["default skills", "skills", {}, `${H}/.agents/skills`],
  ["events: CATALYST_DIR is the test-isolation alias", "events", { CATALYST_DIR: "/d", fn: "events" }, "/d/events"],
  ["events: CATALYST_DIR outranks the manifest", "events", { CATALYST_DIR: "/d", CATALYST_PATHS_FILE: file(manifest({})), fn: "events" }, "/d/events"],
  ["events: CATALYST_EVENTS_DIR outranks CATALYST_DIR", "events", { CATALYST_DIR: "/d", CATALYST_EVENTS_DIR: "/v", fn: "events" }, "/v"],
  ["events: the manifest without an alias", "events", { CATALYST_PATHS_FILE: file(manifest({})), fn: "events" }, "/m/events"],
];

function envFor(extra) {
  const { fn, ...rest } = extra;
  return { PATH: process.env.PATH, HOME: H, ...rest };
}

// A PATH with node but no jq: the shell resolver must read the manifest through node (CTC-3787,
// emit-reap-intent.sh promises to work without jq).
const NO_JQ = join(T, "no-jq-bin");
mkdirSync(NO_JQ);
// The real node: under bun test, process.execPath is bun.
symlinkSync(spawnSync("/bin/sh", ["-c", "command -v node"], { encoding: "utf8" }).stdout.trim(), join(NO_JQ, "node"));

function viaShell(role, extra, path = process.env.PATH) {
  const call = extra.fn === "events" ? "catalyst_events_dir" : `catalyst_path ${role}`;
  const r = spawnSync("/bin/bash", ["-c", `source '${SH}'; ${call}`], { env: { ...envFor(extra), PATH: path }, encoding: "utf8" });
  if (r.status === 2) return "REFUSE";
  if (r.status === 3) return "UNSET";
  if (r.status !== 0) return `rc=${r.status} ${r.stderr}`;
  return r.stdout;
}

function viaNode(role, extra) {
  try {
    const value = extra.fn === "events" ? eventsDir(envFor(extra)) : resolveRole(role, envFor(extra));
    return value === undefined ? "UNSET" : value;
  } catch {
    return "REFUSE";
  }
}

describe("catalyst-paths resolvers", () => {
  for (const [name, role, extra, expected] of CASES) {
    test(`shell: ${name}`, () => expect(viaShell(role, extra)).toBe(expected));
    test(`shell without jq: ${name}`, () => expect(viaShell(role, extra, NO_JQ)).toBe(expected));
    test(`node: ${name}`, () => expect(viaNode(role, extra)).toBe(expected));
  }

  test("the Node CLI prints the resolved path", () => {
    const r = spawnSync(process.execPath, [join(repoRoot, "vendor-src/scripts/lib/catalyst-paths.mjs"), "events"], {
      env: envFor({ CATALYST_EVENTS_DIR: "/cli/events" }),
      encoding: "utf8",
    });
    expect(r.stdout).toBe("/cli/events");
  });
});

// CTC-3786: a script that builds a ~/catalyst path by hand bypasses the contract. The resolver's own
// legacy constant and the vendored paths package are the only places that may name one.
const HARDCODED = [
  /(\$HOME|\$\{HOME\}|~|homedir\(\)\}?)\/catalyst\/events/,
  /(\$HOME|\$\{HOME\}|~|homedir\(\)\}?)\/catalyst\/wt\b/,
  /catalystDir\(\),\s*["']events["']/,
];
const EXEMPT = [/^lib\/catalyst-paths\.(sh|mjs)$/, /^lib\/paths\//];

function scripts(dir, base = dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? scripts(full, base) : [full.slice(base.length + 1)];
  });
}

describe("no hardcoded Catalyst paths in vendor-src/scripts", () => {
  test("control: the pattern catches the old forms", () => {
    for (const line of ['dir="$HOME/catalyst/events"', 'WORKTREES_BASE="$HOME/catalyst/wt/${KEY}"', 'x="${HOME}/catalyst/events"', "resolve(catalystDir(), \"events\", ym)"])
      expect(HARDCODED.some((re) => re.test(line))).toBe(true);
  });

  test("every event-log and worktree path goes through lib/catalyst-paths", () => {
    const root = join(repoRoot, "vendor-src/scripts");
    const hits = scripts(root)
      .filter((rel) => !EXEMPT.some((re) => re.test(rel)))
      .flatMap((rel) =>
        readFileSync(join(root, rel), "utf8")
          .split("\n")
          .flatMap((line, i) => (HARDCODED.some((re) => re.test(line)) ? [`${rel}:${i + 1} ${line.trim()}`] : [])),
      );
    expect(hits).toEqual([]);
  });
});

// CTC-3791: an owner comes only from a hosted origin, never from a local path.
// handoff-durability.sh can run under zsh, so the parser must not depend on BASH_REMATCH.
const SHELLS = ["bash", ...(spawnSync("zsh", ["-c", "true"]).status === 0 ? ["zsh"] : [])];
describe.each(SHELLS)("catalyst_parse_origin (%s)", (shell) => {
  const parse = (url) => spawnSync(shell, ["-c", `source '${SH}'; catalyst_parse_origin "$1"`, "x", url], { encoding: "utf8" });
  for (const [url, expected] of [
    ["git@github.com:coalesce-labs/catalyst.git", "coalesce-labs\tcatalyst"],
    ["github.com:coalesce-labs/catalyst.git", "coalesce-labs\tcatalyst"],
    ["https://github.com/coalesce-labs/catalyst", "coalesce-labs\tcatalyst"],
    ["ssh://git@gitlab.example.com/acme/app.v2.git", "acme\tapp.v2"],
    ["/srv/git/acme/app.git", null],
    ["file:///srv/git/acme/app.git", null],
    ["../acme/app", null],
  ]) {
    test(`${url} → ${expected ?? "no owner"}`, () => {
      const r = parse(url);
      if (expected === null) expect(r.status).toBe(1);
      else expect(r.stdout).toBe(expected);
    });
  }
});
