#!/usr/bin/env node
// check-public-prose.mjs — skill prose reads as public, harness-agnostic documentation.
//
// Run: node scripts/check-public-prose.mjs [--json]   (exit 1 when anything is found)
//
// The pack is published: anyone installs it with `npx skills`, into Claude Code, Codex, OpenCode or
// Cursor. So every Markdown file an installer receives (skills/**/*.md) and the install docs follow
// these rules:
//   1. A skill is named bare (`ask`), never through a plugin prefix (`catalyst-dev:ask`, `catalyst-cloud:catalyst-linear`).
//   2. No person is named: "the owner", "an admin", "the person".
//   3. No provenance: ticket ids, ADR numbers, dated history. The rule stays; how it came about goes.
//   4. Only what an installer has: the two published packs, the `catalyst` CLI (never the retired
//      `catalyst-skills` name), public repos and docs.
//   5. A person's account is "your cloud account", never a "tenant".
//   6. AI accounts are token-billed (an API key is billed per token by its provider). No
//      subscription, plan tier, setup token, subscription login or usage window, in prose or code.
// Dates are checked in prose only; a code block may show an example timestamp.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Team keys whose ids are real tickets. A placeholder (ENG-123, PROJ-1, ABC-9) stays legal.
const TEAM_KEYS = ["CTC", "CTL", "ADV", "OTL", "CRM", "POS", "MCP", "EVR", "SLI", "OBS", "JOB", "COA"];

export const RULES = [
  { id: "plugin-prefix", why: "name the skill bare; the plugin packaging is retired", re: /\bcatalyst-(dev|cloud|pm):[a-z]/ },
  { id: "named-person", why: "say the owner, an admin or the person", re: /\b(Ryan|Rozich)\b/i },
  { id: "ticket-id", why: "drop the ticket id; keep the rule", re: new RegExp(`\\b(${TEAM_KEYS.join("|")})-\\d+\\b`) },
  { id: "adr-id", why: "drop the ADR reference; keep the rule", re: /\bADR[- ]?\d|\bADR-\d{8}T/ },
  { id: "dated-history", why: "drop the date; keep the rule", re: /\b20\d\d-\d\d-\d\d\b/, proseOnly: true },
  { id: "retired-cli", why: "the CLI is `catalyst` (npx -p @catalyst-cloud/cli catalyst <verb>)", re: /(?<![\w-])catalyst-skills\b/ },
  {
    id: "private-reference",
    why: "reference only the published packs and public repos",
    re: /coalesce-labs\/(catalyst-cloud(?!-skills)|thoughts)\b|\bLantern\b|\bexecution-core\b/,
  },
  // People and their accounts are never "tenants". Identifiers keep their names, so inline code and
  // link targets are left out of this check: `tenantId`, `/v1/tenant/...`, `tenant-0`.
  { id: "tenant-word", why: "say your cloud account or the cloud account", re: /\btenants?\b/i, proseOnly: true, identifiersExempt: true },
  // AI accounts are token-billed; no published text names a subscription or how one is used.
  { id: "ai-subscription", why: "describe an AI account billed per token; for an event stream say watch or listener", re: /\bsubscriptions?\b/i },
  { id: "setup-token", why: "say an API key from the provider", re: /\bsetup[- ]?tokens?\b/i },
  {
    id: "plan-tier",
    why: "say nothing about plans",
    re: /\b(?:claude\s+(?:pro|max|team)|chatgpt\s+(?:plus|pro|team|business|enterprise)|(?:max|pro|coding)\s+plans?|max\s+(?:5|20)x|plan\s+tiers?)\b/i,
  },
  {
    id: "usage-window",
    why: "say usage limits, or that a provider is limiting the account",
    re: /\b(?:(?:5|five)[- ]?h(?:ou)?r?\s+(?:and\s+(?:a\s+)?)?(?:(?:7|seven)[- ]day\s+)?(?:windows?|limits?|caps?|resets?)|window\s+usage|(?:7|seven)[- ]day\s+(?:windows?|limits?|caps?)|weekly\s+(?:windows?|limits?|caps?)|usage\s+windows?|rate\s+windows?)\b/i,
  },
  { id: "subscription-login", why: "the account's own page says what it takes", re: /auth\.json|\.credentials\.json|sign in with (?:chatgpt|claude)|claude\.ai\s+(?:account|login)|claude_code_oauth_token|\bcodex login\b(?!\s+--with-api-key)/i },
];

const withoutIdentifiers = (line) => line.replace(/`[^`]*`/g, "").replace(/\]\([^)]*\)/g, "]");

function listMarkdown(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listMarkdown(full);
    return entry.endsWith(".md") ? [full] : [];
  });
}

export function targets(root = repoRoot) {
  return [...listMarkdown(join(root, "skills")), join(root, "README.md"), join(root, ".agents", "install-block.md")];
}

/** findings(file, text) → [{file, line, rule, text}] for every rule a line breaks. */
export function findings(file, text) {
  const out = [];
  let fenced = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    for (const rule of RULES) {
      if (rule.proseOnly && fenced) continue;
      if (rule.re.test(rule.identifiersExempt ? withoutIdentifiers(line) : line)) out.push({ file, line: i + 1, rule: rule.id, text: line.trim().slice(0, 160) });
    }
  });
  return out;
}

export function check(root = repoRoot) {
  return targets(root).flatMap((file) => findings(relative(root, file), readFileSync(file, "utf8")));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = check();
  if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
  else {
    for (const f of found) console.log(`${f.file}:${f.line}  ${f.rule}  ${f.text}`);
    const why = Object.fromEntries(RULES.map((r) => [r.id, r.why]));
    const counts = {};
    for (const f of found) counts[f.rule] = (counts[f.rule] ?? 0) + 1;
    for (const [rule, n] of Object.entries(counts)) console.log(`PUBLIC-PROSE ${rule}: ${n} (${why[rule]})`);
    console.log(`PUBLIC-PROSE: ${found.length} finding(s) in ${new Set(found.map((f) => f.file)).size} file(s)`);
  }
  process.exitCode = found.length ? 1 : 0;
}
