// branch-waiter-cli.test.mjs — the branch waiter's wait, run through the released catalyst CLI.
//
// Run: bun test tests/branch-waiter-cli.test.mjs
// Needs `catalyst` on PATH, or CATALYST_REAL_CLI naming the released CLI's executable, whatever
// its file name. Every control runs that exact file: the direct ones start it by its path, and
// the published wait reaches it through a `catalyst` link that is first on PATH.
//
// tests/branch-waiter.test.mjs runs the published Bash against a stand-in for `catalyst`, and a
// stand-in accepts whatever it was written to accept. The wait this reference first shipped
// passed every control there while the released CLI refused it outright, so no waiter ever
// waited. These controls put the same published wait through the CLI's own option parser and
// exit codes. No cloud is involved: the CLI gets a scratch home whose config names a closed
// local port, so a wait can only end with no event.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const reference = readFileSync(new URL("../vendor-src/references/branch-waiter.md", import.meta.url), "utf8");

function releasedCli(from = process.env) {
  const named = from.CATALYST_REAL_CLI;
  if (named) return existsSync(named) ? named : null;
  for (const dir of (from.PATH ?? "").split(":")) {
    if (dir && existsSync(join(dir, "catalyst"))) return join(dir, "catalyst");
  }
  return null;
}

const cli = releasedCli();
// CI installs the released CLI before the suites run, so a missing CLI fails there. On a
// machine without one, these controls are reported as skipped by name, never as passed.
const contract = cli || process.env.CI ? test : test.skip;

// A scratch home for one control. `selected` is the executable under test. The only `catalyst`
// the published wait can find first is a one-line launcher for it, so a `catalyst` anywhere on
// the ambient path is never the one that runs.
function withScratchHome(run, selected = cli, ambientPath = process.env.PATH ?? "") {
  const home = mkdtempSync(join(tmpdir(), "branch-waiter-cli-"));
  try {
    mkdirSync(join(home, ".config", "catalyst-cloud"), { recursive: true });
    writeFileSync(
      join(home, ".config", "catalyst-cloud", "customer.json"),
      JSON.stringify({ account: "contract-test", baseUrl: "http://127.0.0.1:9", key: "contract-test-not-a-key" }),
    );
    const bin = join(home, "bin");
    mkdirSync(bin);
    const quoted = `'${String(selected ?? "/nonexistent/catalyst").replace(/'/g, `'\\''`)}'`;
    writeFileSync(join(bin, "catalyst"), `#!/bin/bash\nexec ${quoted} "$@"\n`, { mode: 0o755 });
    const env = { PATH: `${bin}:${ambientPath}`, HOME: home, CATALYST_SKILLS_HOME: home };
    return run(home, env);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// The two ways these controls start the CLI. The published wait calls `catalyst`, which in this
// environment is the launcher for the selected executable. The direct control takes its path.
function runPublishedWait(home, env) {
  const log = join(home, "waiter.log");
  const run = spawnSync(
    "bash",
    ["-c", 'bash -c "$1" "$2" "$3" "$4" "$6" > "$5" 2>&1', "contract", publishedWait(), "coalesce-labs/example:fix-replica", "ENG-123", "1", log, "1"],
    { env, encoding: "utf8", timeout: 60000 },
  );
  return { run, logged: existsSync(log) ? readFileSync(log, "utf8") : "" };
}
function runDirect(selected, args, env) {
  return spawnSync(selected, args, { env, encoding: "utf8", timeout: 60000 });
}

// The wait the arm function starts, exactly as published: the single-quoted script it hands to
// `bash -c`, followed by the ref, ticket, cursor and timeout as positional arguments.
function publishedWait() {
  const found = reference.match(/nohup bash -c '([^']+)' "\$ref" "\$ticket" "\$cursor" "\$secs" >&9 2>&1 &/);
  if (!found) throw new Error("the arm function no longer starts its wait in the form this control reads");
  return found[1];
}

contract("released CLI: the published wait is accepted, and a wait that ends with no event is recorded as 124", () => {
  expect(cli).not.toBeNull();
  withScratchHome((home, env) => {
    const { run, logged } = runPublishedWait(home, env);
    expect(run.status).toBe(0);
    expect(logged).not.toContain("must be an integer");
    expect(logged).not.toContain("unknown option");
    expect(logged).not.toContain("Usage:");
    expect(logged).toContain("events: no matching event within 1 s");
    expect(logged.trimEnd().endsWith("cursor 1\nwaiter-rc 124")).toBe(true);
  });
});

contract("released CLI: a wait that ends with no event exits 1 and says so in the line the waiter reads", () => {
  expect(cli).not.toBeNull();
  withScratchHome((_home, env) => {
    const run = runDirect(cli, ["events", "wait-for", "--ticket", "ENG-123", "--after", "1", "--timeout", "1"], env);
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/^events: no matching event within 1 s$/m);
  });
});

// The control that shows these tests can fail: the wait as first shipped, which the stand-in
// took for a month. The released CLI refuses it before it waits at all.
contract("released CLI: a timeout that is not whole seconds is refused, as the wait first shipped was", () => {
  expect(cli).not.toBeNull();
  withScratchHome((_home, env) => {
    const run = runDirect(cli, ["events", "wait-for", "--type", "pr.conflict.detected", "--type", "comms.message.posted", "--ticket", "ENG-123", "--after", "1", "--timeout", "4h"], env);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("--timeout must be an integer");
  });
});

// These controls are only worth anything if they run the executable that was selected. This one
// needs no released CLI: the selected executable is a stand-in under another file name, and a
// `catalyst` that must never run sits beside it and is first on the ambient path. Both record
// every call. It fails if a control starts `catalyst` by name from the selected file's folder.
test("selection: the published wait and the direct controls run the selected executable, never another catalyst on the path", () => {
  const dir = mkdtempSync(join(tmpdir(), "branch-waiter-cli-pick-"));
  try {
    const calls = join(dir, "calls");
    const selected = join(dir, "released-cli-under-test");
    const standIn = (name) => `#!/bin/bash\necho "${name} $*" >> '${calls}'\necho "events: no matching event within 1 s" >&2\nexit 1\n`;
    writeFileSync(selected, standIn("selected"), { mode: 0o755 });
    writeFileSync(join(dir, "catalyst"), standIn("decoy"), { mode: 0o755 });
    const ambient = `${dir}:${process.env.PATH ?? ""}`;

    expect(releasedCli({ CATALYST_REAL_CLI: selected, PATH: ambient })).toBe(selected);
    // The control: on the ambient path alone, `catalyst` is the decoy.
    expect(spawnSync("bash", ["-c", "command -v catalyst"], { env: { PATH: ambient }, encoding: "utf8" }).stdout.trim()).toBe(join(dir, "catalyst"));

    withScratchHome((home, env) => {
      const { run, logged } = runPublishedWait(home, env);
      expect(run.status).toBe(0);
      expect(logged.trimEnd().endsWith("cursor 1\nwaiter-rc 124")).toBe(true);
      expect(runDirect(selected, ["events", "wait-for", "--ticket", "ENG-123", "--after", "1", "--timeout", "1"], env).status).toBe(1);
    }, selected, ambient);

    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual([
      "selected events wait-for --ticket ENG-123 --after 1 --timeout 1", // the published wait
      "selected events wait-for --ticket ENG-123 --after 1 --timeout 1", // the direct control
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The arm function starts a wait from a saved sequence even when the status read fails. That is
// only safe if such a wait cannot come straight back: these two controls hold the released CLI
// to it. With the cloud unreachable the status read fails, and a wait still lasts its timeout.
contract("released CLI: with the cloud unreachable the status read fails and a wait lasts its timeout, so a re-arm cannot spin", () => {
  expect(cli).not.toBeNull();
  withScratchHome((_home, env) => {
    const status = runDirect(cli, ["events", "status", "--json"], env);
    expect(status.status).not.toBe(0);
    const started = Date.now();
    const run = runDirect(cli, ["events", "wait-for", "--ticket", "ENG-123", "--after", "1", "--timeout", "3"], env);
    const elapsed = Date.now() - started;
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^events: no matching event within 3 s$/m);
    expect(elapsed).toBeGreaterThanOrEqual(2500);
  });
});
