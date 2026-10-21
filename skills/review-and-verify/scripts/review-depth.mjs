#!/usr/bin/env node
// review-depth.mjs — light or deep review for a pinned base..head, from the paths it changes.
//
// Usage: node review-depth.mjs --base <sha> [--head <sha>] [--door one-way|two-way] [--config <settings file>]
//
// A caller that already knows the door (the cloud passes it) names it with --door, and that wins.
// Otherwise the changed paths are matched against `[review] one_way_paths` in the repository's
// settings file (`.catalyst/catalyst.toml`; JavaScript regular expressions, as the cloud reads them),
// or against DEFAULT_ONE_WAY_PATHS when the repository declares none. It fails closed: an empty
// change list or a declaration that cannot be read is deep.
//
// Prints `depth:`, `source:` and one `match: <path>  <pattern>` line per one-way path. Exit 0 with a
// depth, 2 when the input is unusable.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_ONE_WAY_PATHS = [
  "(?:^|/)migrations?/",
  "(?:^|/)schema\\.prisma$",
  "^\\.github/workflows/",
  "(?:^|/)Dockerfile[^/]*$",
  "(?:^|/)wrangler\\.(?:toml|jsonc?)$",
  "\\.tf$",
  "(?:^|/)install\\.sh$",
  "(?:^|/)(?:auth|crypto|billing|payments?)/",
  "(?:^|/)\\.mergify\\.yml$",
];

// The `[review] one_way_paths` array of a settings file, as strings. Returns undefined when the key
// is absent, and throws when it is present but not an array of single-line strings.
export function declaredOneWayPaths(toml) {
  const lines = toml.split("\n");
  let inReview = false;
  let body = "";
  for (const line of lines) {
    const header = line.match(/^\s*\[\s*([^\]\s]+)\s*\]\s*(?:#.*)?$/);
    if (header) {
      if (inReview) break;
      inReview = header[1] === "review";
      continue;
    }
    if (inReview) body += `${line}\n`;
  }
  const start = body.search(/^\s*one_way_paths\s*=/m);
  if (start < 0) return undefined;
  let i = body.indexOf("=", start) + 1;
  while (/\s/.test(body[i] ?? "")) i++;
  if (body[i] !== "[") throw new Error("one_way_paths is not an array");
  i++;
  const values = [];
  for (;;) {
    while (/[\s,]/.test(body[i] ?? "")) i++;
    const c = body[i];
    if (c === undefined) throw new Error("one_way_paths is not closed");
    if (c === "]") return values;
    if (c === "#") {
      i = body.indexOf("\n", i);
      if (i < 0) throw new Error("one_way_paths is not closed");
      continue;
    }
    if (body.startsWith("'''", i) || body.startsWith('"""', i)) {
      throw new Error("one_way_paths holds a multi-line string");
    }
    if (c === "'") {
      const end = body.indexOf("'", i + 1);
      if (end < 0 || body.slice(i + 1, end).includes("\n")) throw new Error("unclosed string in one_way_paths");
      values.push(body.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let out = "";
      for (;;) {
        const d = body[j];
        if (d === undefined || d === "\n") throw new Error("unclosed string in one_way_paths");
        if (d === '"') break;
        if (d === "\\") {
          const e = body[j + 1];
          const simple = { "\\": "\\", '"': '"', n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
          if (e in simple) {
            out += simple[e];
            j += 2;
          } else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(body.slice(j + 2, j + 6))) {
            out += String.fromCharCode(parseInt(body.slice(j + 2, j + 6), 16));
            j += 6;
          } else {
            throw new Error(`invalid escape \\${e} in one_way_paths`);
          }
          continue;
        }
        out += d;
        j++;
      }
      values.push(out);
      i = j + 1;
      continue;
    }
    throw new Error("one_way_paths holds a value that is not a string");
  }
}

// { depth, source, matches } for a change list and the patterns that apply to it.
export function reviewDepth(changedFiles, patterns, source) {
  if (changedFiles.length === 0) return { depth: "deep", source: `${source} (no changed paths listed)`, matches: [] };
  const compiled = patterns.map((p) => ({ p, re: new RegExp(p) }));
  const matches = [];
  for (const f of changedFiles) {
    const hit = compiled.find(({ re }) => re.test(f));
    if (hit) matches.push({ path: f, pattern: hit.p });
  }
  return { depth: matches.length > 0 ? "deep" : "light", source, matches };
}

function main(argv) {
  const arg = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const door = arg("--door");
  if (door !== undefined) {
    if (door !== "one-way" && door !== "two-way") return fail("--door must be one-way or two-way");
    console.log(`depth: ${door === "one-way" ? "deep" : "light"}\nsource: caller (--door ${door})`);
    return 0;
  }
  const base = arg("--base");
  const head = arg("--head") ?? "HEAD";
  if (!base) return fail("--base <sha> is required without --door");
  let files;
  try {
    const out = execFileSync("git", ["diff", "--name-only", "--no-renames", base, head], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    files = out.split("\n").filter(Boolean);
  } catch {
    return fail(`git diff ${base} ${head} failed: the base or head does not resolve`);
  }
  const config = arg("--config") ?? ".catalyst/catalyst.toml";
  let patterns = DEFAULT_ONE_WAY_PATHS;
  let source = "default list (no [review] one_way_paths declared)";
  if (existsSync(config)) {
    try {
      const declared = declaredOneWayPaths(readFileSync(config, "utf8"));
      if (declared !== undefined) {
        declared.forEach((p) => new RegExp(p));
        patterns = declared;
        source = `${config} [review] one_way_paths`;
      }
    } catch (error) {
      console.log(`depth: deep\nsource: ${config} [review] one_way_paths could not be read (${error.message})`);
      return 0;
    }
  }
  const result = reviewDepth(files, patterns, source);
  console.log(`depth: ${result.depth}\nsource: ${result.source}`);
  for (const m of result.matches) console.log(`match: ${m.path}  ${m.pattern}`);
  return 0;
}

function fail(reason) {
  console.log(`depth: unknown\nreason: ${reason}`);
  return 2;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
