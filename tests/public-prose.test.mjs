// public-prose.test.mjs — every skill reads as public, harness-agnostic documentation, and every
// SKILL.md frontmatter follows the Agent Skills specification.
//
// Run: bun test tests/public-prose.test.mjs
//
// scripts/check-public-prose.mjs owns the prose rules; this file holds the tree to them and proves
// each rule still matches what it is meant to catch.

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { RULES, check, findings, targets } from "../scripts/check-public-prose.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("skill prose is public and harness-agnostic", () => {
  // Positive controls: one planted line per rule, each caught by exactly that rule.
  const planted = {
    "plugin-prefix": "Run `/catalyst-dev:create-plan` first.",
    "named-person": "Ask Ryan before merging.",
    "ticket-id": "This guard came from CTC-1234.",
    "adr-id": "See ADR-20260927T224315 for the layout.",
    "dated-history": "Decided on 2026-09-26, so the rail is gone.",
    "retired-cli": "Run `catalyst-skills query issue ENG-1`.",
    "private-reference": "Clone coalesce-labs/catalyst-cloud and ask Lantern.",
    "tenant-word": "Move the card on the tenant's board.",
    "ai-subscription": "Phases run at your subscription's rate.",
    "setup-token": "Paste what `claude setup-token` prints.",
    "plan-tier": "Works with Claude Pro or Max.",
    "usage-window": "Subscriptions have 5-hour and 7-day windows.",
    "subscription-login": "Run `codex login` and paste ~/.codex/auth.json.",
  };
  const plantedMore = [
    ["subscription-login", "copy ~/.claude/.credentials.json"],
    ["plan-tier", "a Max 20x account"],
    ["usage-window", "the 5h window resets at noon"],
    ["plan-tier", "Connect your ChatGPT **Plus** account"],
    ["plan-tier", "works with Claude [Max](https://example.com/max)"],
  ];

  test("control: the widened subscription patterns catch their lines", () => {
    for (const [rule, line] of plantedMore) expect(findings("planted.md", line).map((f) => f.rule), line).toContain(rule);
  });

  test("control: every planted line has its rule, and every rule a planted line", () => {
    expect(Object.keys(planted).filter((id) => !RULES.some((r) => r.id === id))).toEqual([]);
    expect(RULES.map((r) => r.id).filter((id) => !(id in planted))).toEqual([]);
  });

  for (const rule of RULES) {
    test(`control: the ${rule.id} rule catches its planted line`, () => {
      expect(findings("planted.md", planted[rule.id]).map((f) => f.rule)).toContain(rule.id);
    });
  }

  test("control: every retired plugin prefix is caught, not only this pack's", () => {
    for (const line of ["Use `catalyst-cloud:ask` first.", "Run `/catalyst-pm:plan`."]) {
      expect(findings("planted.md", line).map((f) => f.rule)).toContain("plugin-prefix");
    }
  });

  test("control: what the rules must leave alone", () => {
    const clean = [
      "Create ENG-123 with the `linear` skill (`/linear` in Claude Code, `$linear` in Codex).",
      "Ask the owner; an admin can change it.",
      "Install with `npx skills@latest add coalesce-labs/catalyst-cloud-skills --all -g`.",
      "Run `npx -p @catalyst-cloud/cli catalyst query issue ENG-1`.",
      "```\nthoughts/shared/handoffs/ENG-1/2025-01-08_13-44-55_auth.md\n```",
      "The development pack is `coalesce-labs/catalyst-dev-skills`.",
      "Move the card on your cloud account's board; the route is `/v1/tenant/:id` and the field `tenantId`.",
      "See [the contract](https://example.com/tenant-contract).",
      "```\ncatalyst query issue ENG-1 --tenant tenant-0\n```",
      "Settings → AI accounts lists the providers your workspace can connect; an API key is billed per token by its provider.",
      "Run `codex login --with-api-key` with your key.",
      "Set `CLAUDE_MAX_TURNS` in the environment.",
      "A phase that runs past its 5-hour build timeout is stopped.",
      "One multi-event watch wakes on PR merge, CI and review events.",
      "Write the plan, then the plan phase reviews it.",
    ].join("\n");
    expect(findings("clean.md", clean)).toEqual([]);
  });

  test("no skill, README or install block breaks a rule", () => {
    const found = check(repoRoot).map((f) => `${f.file}:${f.line} ${f.rule}  ${f.text}`);
    expect(found).toEqual([]);
  });
});

describe("every skill the prose names exists", () => {
  // The Cloud pack's skills, which this pack may point at by name.
  const CLOUD_SKILLS = [
    "catalyst-github", "catalyst-linear", "catalyst-onboard", "catalyst-setup", "connect-me",
    "how-catalyst-works", "run-this-project", "unstick", "what-needs-me", "whats-happening",
  ];
  // Mergify's own published skills, which merge-pr points at for its merge queue.
  const MERGIFY_SKILLS = ["mergify-merge-queue", "mergify-config"];
  const known = new Set([...readdirSync(join(repoRoot, "skills")), ...CLOUD_SKILLS, ...MERGIFY_SKILLS]);

  test("a reference like `name` skill names a skill in this pack or the Cloud pack", () => {
    const unknown = targets(repoRoot).flatMap((file) =>
          [...readFileSync(file, "utf8").matchAll(/`\/?\$?([a-z0-9-]+)` skill/g)]
            .map((m) => m[1])
            .filter((name) => !known.has(name))
            .map((name) => `${relative(repoRoot, file)}: ${name}`),
        );
    expect(unknown).toEqual([]);
  });
});

describe("SKILL.md frontmatter follows the Agent Skills specification", () => {
  const skills = readdirSync(join(repoRoot, "skills")).filter((d) => existsSync(join(repoRoot, "skills", d, "SKILL.md")));
  const front = (d) => {
    const text = readFileSync(join(repoRoot, "skills", d, "SKILL.md"), "utf8");
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    return m ? Bun.YAML.parse(m[1]) : {};
  };

  test("the pack has skills to check", () => {
    expect(skills.length).toBeGreaterThanOrEqual(28);
  });

  test("every name is lowercase-hyphenated, at most 64 characters, and matches its directory", () => {
    const bad = skills.filter((d) => {
      const name = front(d).name;
      return typeof name !== "string" || name !== d || name.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
    });
    expect(bad).toEqual([]);
  });

  test("a skill whose description says to apply it routinely lets the agent invoke it", () => {
    const bad = skills.filter((d) => {
      const f = front(d);
      return f["disable-model-invocation"] === true && /\b(always|every|routinely)\b/i.test(String(f.description));
    });
    expect(bad).toEqual([]);
  });

  test("unslop is the writing standard agents apply without being asked", () => {
    const f = front("unslop");
    expect(f["disable-model-invocation"]).not.toBe(true);
    expect(String(f.description)).toMatch(/everything a person reads/);
  });

  test("every description is non-empty and at most 1024 characters", () => {
    const bad = skills
      .map((d) => [d, String(front(d).description ?? "")])
      .filter(([, desc]) => desc.length === 0 || desc.length > 1024)
      .map(([d, desc]) => `${d}: ${desc.length}`);
    expect(bad).toEqual([]);
  });
});
