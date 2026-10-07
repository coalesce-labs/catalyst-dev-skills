// unattended-mode.test.mjs — in unattended mode (`CATALYST_PHASE` set), each skill reaches its
// output without asking and waiting. CTC-5182: this replaces the runner's injected skip-the-waits
// text and its phrase scanner; the rule now lives in the skills, and this is the one test for it.
//
// Run: bun test tests/unattended-mode.test.mjs

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DISPATCHED_SKILLS,
  PHASE_SKILLS,
  findUnguardedWaits,
  modeEchoProblems,
  packProblems,
  skillDocuments,
} from "../scripts/check-unattended.mjs";

const skillsDir = fileURLToPath(new URL("../skills", import.meta.url));

describe("every ask or wait step in a dispatched skill is guarded by CATALYST_PHASE", () => {
  test("no unguarded wait in any dispatched SKILL.md or its references", () => {
    expect(packProblems(skillsDir)).toEqual([]);
  });

  test("the scan covers the phase skills and the in-session skills a phase runs", () => {
    for (const name of [
      ...PHASE_SKILLS,
      "unslop",
      "validate-type-safety",
      "scan-reward-hacking",
      "review-code",
      "review-security",
      "fix-typescript",
    ]) {
      expect(DISPATCHED_SKILLS).toContain(name);
    }
  });

  test("each phase skill that can wait prints the mode before its first possible wait", () => {
    expect(modeEchoProblems(skillsDir)).toEqual([]);
  });

  test("the skills a pipeline phase runs each carry the rule", () => {
    for (const name of PHASE_SKILLS) {
      const body = readFileSync(`${skillsDir}/${name}/SKILL.md`, "utf8");
      expect(body, name).toMatch(/CATALYST_PHASE/);
    }
  });

  test("research-codebase goes straight to its steps under CATALYST_PHASE", () => {
    const body = readFileSync(`${skillsDir}/research-codebase/SKILL.md`, "utf8");
    const start = body.slice(body.indexOf("## Start"), body.indexOf("## ", body.indexOf("## Start") + 3));
    expect(start).toMatch(/CATALYST_PHASE/);
    expect(findUnguardedWaits(start)).toEqual([]);
  });

  test("a dispatched skill that is missing fails loudly, never silently", () => {
    expect(() => skillDocuments(skillsDir, ["no-such-skill"])).toThrow(/no-such-skill/);
  });

  test("the scan reads the pack it claims to (positive control on the file set)", () => {
    const files = skillDocuments(skillsDir).map((f) => f.slice(skillsDir.length + 1));
    expect(files).toContain("research-codebase/SKILL.md");
    expect(files).toContain("create-plan/SKILL.md");
    expect(files.some((f) => f.includes("/references/"))).toBe(true);
    expect(files).toContain("remediate-plan/assets/references/resolving-review-findings.md");
  });
});

describe("POSITIVE CONTROL: the check fails a skill that would stall a phase", () => {
  test("an unguarded 'wait for the user' step fails", () => {
    const skill = ["## Start", "", "Reply that you are ready, then wait for the user's question.", ""].join("\n");
    expect(findUnguardedWaits(skill)).toEqual([
      { line: 3, text: "Reply that you are ready, then wait for the user's question." },
    ]);
  });

  test("an unguarded [Y/n] prompt and an unguarded ask-whether fail", () => {
    const skill = ["## Pick", "Ask **Proceed?** [Y/n].", "- Ask whether to plan from it."].join("\n");
    expect(findUnguardedWaits(skill).map((p) => p.line)).toEqual([2, 3]);
  });

  test("a guard AFTER the wait does not cover it", () => {
    const skill = [
      "## Start",
      "Then wait for the user's research query.",
      "When `CATALYST_PHASE` is set, never ask and wait: go straight to the steps.",
    ].join("\n");
    expect(findUnguardedWaits(skill).map((p) => p.line)).toEqual([2]);
  });

  test("a guard in ANOTHER section does not cover it", () => {
    const skill = [
      "## Rules",
      "When `CATALYST_PHASE` is set, never ask and wait.",
      "## Start",
      "Then wait for the user's research query.",
    ].join("\n");
    expect(findUnguardedWaits(skill).map((p) => p.line)).toEqual([4]);
  });

  test("a line that only mentions CATALYST_PHASE for something else is not a guard", () => {
    const skill = [
      "## Start",
      "Skip the linearis call when `CATALYST_PHASE` is set.",
      "Then wait for the user's research query.",
    ].join("\n");
    expect(findUnguardedWaits(skill).map((p) => p.line)).toEqual([3]);
  });

  test("'and ask:' forms and an agreement-at-each-step instruction fail", () => {
    const skill = [
      "## Find the PR",
      "If there is no PR on the branch, list recent PRs and ask:",
      "Build the plan with the person and get their agreement at each step.",
    ].join("\n");
    expect(findUnguardedWaits(skill).map((p) => p.line)).toEqual([2, 3]);
  });

  test("a line that names CATALYST_PHASE but still waits fails (it must say the unattended behaviour)", () => {
    const skill = ["## Start", "When `CATALYST_PHASE` is set, wait for the user's question."].join(
      "\n",
    );
    expect(findUnguardedWaits(skill).map((p) => p.line)).toEqual([2]);
  });

  test("a mode echo after the first wait, or no echo at all, fails", () => {
    const late = [
      "## Start",
      "Otherwise reply, then wait for the user's question.",
      "```bash",
      'if [[ -n "${CATALYST_PHASE:-}" ]]; then echo "unattended: never ask and wait"; fi',
      "```",
    ].join("\n");
    expect(modeEchoProblems.forText(late)).toMatch(/after the first/);
    expect(modeEchoProblems.forText("## Start\nThen wait for the user's question.\n")).toMatch(
      /no mode echo/,
    );
  });

  test("a guarded section, or a wait that names the guard itself, passes", () => {
    const guarded = [
      "## Start",
      "When `CATALYST_PHASE` is set, never ask and wait: take the question from the arguments.",
      "Otherwise reply, then wait for the user's research query.",
      "- Unless `CATALYST_PHASE` is set, ask whether to plan from it, and wait.",
    ].join("\n");
    expect(findUnguardedWaits(guarded)).toEqual([]);
  });

  test("a wait inside a code fence is example text, not an instruction", () => {
    const skill = ["## Start", "```", "Please wait for the user to reply.", "```"].join("\n");
    expect(findUnguardedWaits(skill)).toEqual([]);
  });
});
