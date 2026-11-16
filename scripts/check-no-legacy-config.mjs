#!/usr/bin/env node
// check-no-legacy-config.mjs — no tracked file mentions the retired repository settings file (CTC-10759).
//
// Repository settings live in `.catalyst/catalyst.toml`. The older JSON settings file is gone, and a
// skill or script that points an agent at it sends the agent to a file that does not exist. This
// guard fails when any tracked file spells the path, so a mention cannot come back.
//
// Two spellings stay legal: `.catalyst/config.json.bak-*`, the backup the old CLI left beside the file
// (prune-worktrees still treats a leftover one as residue), and this guard's own source and test,
// which have to name the path to look for it. The machine-level `~/.config/catalyst/config.json` is a
// different file and does not match.
//
// Run: node scripts/check-no-legacy-config.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The retired path, not followed by `.bak-` (the backup suffix). */
export const LEGACY = /\.catalyst\/config\.json(?!\.bak-)/;

const SELF = new Set(["scripts/check-no-legacy-config.mjs", "tests/no-legacy-config.test.mjs"]);

/** mentions(text) → the 1-based line numbers that name the retired file. */
export function mentions(text) {
  const lines = [];
  text.split("\n").forEach((line, i) => {
    if (LEGACY.test(line)) lines.push(i + 1);
  });
  return lines;
}

/** scan(root) → [{ file, lines }] over every tracked file under root. */
export function scan(root) {
  const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((f) => f && !SELF.has(f));
  const found = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(`${root}/${file}`, "utf8");
    } catch {
      continue; // a tracked symlink to a directory, or a file deleted in the working tree
    }
    const lines = mentions(text);
    if (lines.length > 0) found.push({ file, lines });
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const found = scan(root);
  for (const { file, lines } of found) console.error(`${file}:${lines.join(",")} mentions the retired .catalyst/config.json; read catalyst.toml instead`);
  if (found.length > 0) process.exit(1);
  console.log("no-legacy-config: no tracked file names the retired settings file");
}
