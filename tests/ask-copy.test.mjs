// ask-copy.test.mjs — the ask verb's wording checks, on the ask that prompted them. CTC-4075.
//
// Run: bun test tests/ask-copy.test.mjs
//
// Fixtures: CTC-3927 as raised on 2026-09-28 (said "only you" for two steps an agent could do, and
// named neither the GitHub App nor the permission as GitHub shows it) and as rewritten the same day.

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { askCopyFindings } from "../skills/ask/scripts/lib/ask-copy.mjs";

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`fixtures/ask-copy/${name}`, import.meta.url)), "utf8");
const rules = (text) => askCopyFindings(text).map((f) => f.rule);

describe("askCopyFindings", () => {
  test("flags the original CTC-3927 ask on both rules", () => {
    const findings = askCopyFindings(fixture("ctc-3927-original.md"));
    expect(findings.map((f) => f.rule)).toEqual(["only-you", "github-app-without-link"]);
    expect(findings[0].match).toBe("only you");
    expect(findings[0].fix).toContain("we'll create the flag");
    expect(findings[1].fix).toContain("Commit statuses: Read-only");
  });

  test("passes the rewritten CTC-3927 ask", () => {
    expect(askCopyFindings(fixture("ctc-3927-rewritten.md"))).toEqual([]);
  });

  test("catches the other exclusivity phrasings", () => {
    expect(rules("Only a human can approve this.")).toEqual(["only-you"]);
    expect(rules("This needs the human; only the human holds the login.")).toEqual(["only-you"]);
  });

  test("a GitHub App step with its settings link passes", () => {
    const text =
      'Add "Commit statuses: Read-only" to the GitHub App "Catalyst Cloud Connector": ' +
      "https://github.com/organizations/coalesce-labs/settings/apps/catalyst-cloud-connector/permissions";
    expect(rules(text)).toEqual([]);
  });

  test("text that names neither shape passes", () => {
    expect(rules("We create the flag at shadow when you say yes.")).toEqual([]);
  });
});

describe("ask.mjs create", () => {
  test("runs the wording checks and reports them in its JSON", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../skills/ask/scripts/ask.mjs", import.meta.url)),
      "utf8",
    );
    expect(src).toContain('import { askCopyFindings } from "./lib/ask-copy.mjs";');
    expect(src).toContain("const copyFindings = askCopyFindings(`${title}\\n${body}`);");
    expect(src.match(/^\s+copyFindings,$/gm)).toHaveLength(2);
  });
});
