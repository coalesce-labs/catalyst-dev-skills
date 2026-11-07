// The mechanical part of scan-reward-hacking, run by code on the lines a change added: patterns with no
// judgement in finding them. Whether a hit is acceptable stays with the reviewer, who must record it as a
// finding, so a hit cannot pass unread. scan-reward-hacking's SKILL.md owns the full list and the rules.
import { spawnSync } from "node:child_process";

const PATTERNS = [
  ["double cast", /\bas unknown as\b/],
  ["any cast", /\bas any\b/],
  ["void trick", /\bvoid (?:\(0|_)/],
  ["type directive", /@ts-(?:ignore|expect-error|nocheck)\b/],
  ["async forEach", /\.forEach\(async\b/],
  ["lint suppression", /\b(?:eslint-disable|biome-ignore)\b/],
  ["skipped or focused test", /\b(?:(?:it|test|describe)\.(?:skip|only)\(|xit\(|xdescribe\(|fit\(|fdescribe\()/],
];

/** Hits on added lines of `git diff -U0` output. */
export function scanDiff(diff) {
  const hits = [];
  let file = null, line = 0;
  for (const text of diff.split("\n")) {
    if (text.startsWith("+++ ")) { file = text.slice(4).replace(/^b\//, ""); continue; }
    const hunk = /^@@ -\S+ \+(\d+)/.exec(text);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (!text.startsWith("+") || !file) continue;
    for (const [pattern, match] of PATTERNS) if (match.test(text)) hits.push({ file, line, pattern, text: text.slice(1).trim().slice(0, 160) });
    line++;
  }
  return hits;
}

export function scanRange(base, cwd) {
  const diff = (args) => {
    const result = spawnSync("git", ["diff", ...args], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`git diff failed: ${(result.stderr ?? "").slice(0, 300)}`);
    return result.stdout;
  };
  const hits = scanDiff(diff(["-U0", base, "HEAD", "--", "*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs"]));
  for (const file of diff(["--name-only", base, "HEAD", "--", "*tsconfig*.json"]).split("\n").filter(Boolean)) hits.push({ file, line: 1, pattern: "tsconfig changed", text: "" });
  return hits;
}

/** Hits the review did not record as a finding at the same file and line. */
export function unrecorded(hits, findings) {
  return hits.filter((hit) => !findings.some((finding) => finding?.path === hit.file && finding?.line === hit.line));
}
