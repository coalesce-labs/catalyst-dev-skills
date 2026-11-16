// no-legacy-config.test.mjs — nothing in this repository names the retired `.catalyst/config.json`,
// and the guard still catches a planted mention (CTC-10759).
//
// Run: bun test tests/no-legacy-config.test.mjs

import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { mentions, scan } from "../scripts/check-no-legacy-config.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("the retired settings file is not mentioned", () => {
  test("positive control: each spelling an agent could copy is caught", () => {
    expect(mentions("read `.catalyst/config.json` first")).toEqual([1]);
    expect(mentions('cfg="${ROOT}/.catalyst/config.json"')).toEqual([1]);
    expect(mentions("ok\nTEAM=$(jq -r .x .catalyst/config.json)")).toEqual([2]);
  });

  test("the backup suffix, the machine-level file and catalyst.toml are not mentions", () => {
    expect(mentions(".catalyst/config.json.bak-3")).toEqual([]);
    expect(mentions("~/.config/catalyst/config.json")).toEqual([]);
    expect(mentions(".catalyst/catalyst.toml")).toEqual([]);
  });

  test("positive control: a tracked file that names it is found by scan", () => {
    const dir = mkdtempSync(join(tmpdir(), "no-legacy-"));
    execFileSync("git", ["-C", dir, "init", "-q"]);
    mkdirSync(join(dir, "skills"));
    writeFileSync(join(dir, "skills/a.md"), "see .catalyst/config.json\n");
    writeFileSync(join(dir, "skills/b.md"), "see .catalyst/catalyst.toml\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    expect(scan(dir)).toEqual([{ file: "skills/a.md", lines: [1] }]);
  });

  test("no tracked file in this repository names it", () => {
    expect(scan(repoRoot)).toEqual([]);
  });
});
