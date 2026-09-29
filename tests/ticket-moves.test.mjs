// ticket-moves.test.mjs — the coding skills leave workflow moves to events, and name no stage.
//
// Run: bun test tests/ticket-moves.test.mjs
//
// On Catalyst Cloud, the cloud moves a ticket when a phase's outcome is recorded (validate passing
// moves it to the PR slot) and when its pull request merges; opening a PR moves nothing. Off the
// cloud, the ticket stays where it is until the merge. So research, planning, implementation and
// the PR skills write no state and post no PR-link comment. A person who asks for a move uses the
// `catalyst` CLI's slot verb; off the cloud, an operator uses the Linearis CLI directly.

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const CODING = ["research-codebase", "create-plan", "implement-plan", "create-pr", "describe-pr", "merge-pr"];

// The skill's own prose: SKILL.md and references, not vendored assets or scripts.
function prose(skill) {
  const dir = join(repoRoot, "skills", skill);
  const files = [join(dir, "SKILL.md")];
  const refs = join(dir, "references");
  if (existsSync(refs)) for (const f of readdirSync(refs)) if (f.endsWith(".md")) files.push(join(refs, f));
  return files.filter((f) => statSync(f).isFile()).map((f) => [relative(repoRoot, f), readFileSync(f, "utf8")]);
}

const STATE_WRITE = [
  /stateMap\./, // a named stage from local config
  /linear-transition\.sh/, // the direct state-transition helper
  /In Review/, // a display name, not a contract slot
  /issues update[^\n]*--(state|status)/,
  /update (the )?(ticket )?status to/i,
];

describe("coding skills leave ticket moves to events", () => {
  for (const skill of CODING) {
    test(`${skill} writes no ticket state and names no stage`, () => {
      const hits = prose(skill).flatMap(([file, text]) =>
        text.split("\n").flatMap((line, i) => (STATE_WRITE.some((re) => re.test(line)) ? [`${file}:${i + 1} ${line.trim().slice(0, 120)}`] : [])),
      );
      expect(hits).toEqual([]);
    });
  }

  for (const skill of ["create-pr", "describe-pr"]) {
    test(`${skill} posts no PR-link comment and says the ticket waits for the merge`, () => {
      const text = prose(skill).map(([, t]) => t).join("\n");
      expect(text).not.toMatch(/PR[- ]link comment|comment with the PR link/i);
      expect(text).toMatch(/stays (put|where it is) until (the PR |it )?merges/i);
    });
  }

  test("merge-pr names no queue label of its own: a label comes only from the repository's queue config", () => {
    const text = prose("merge-pr").map(([, t]) => t).join("\n");
    expect(text).not.toMatch(/queueLabel|queue:ready/);
  });
});

describe("thoughts setup points at the tool that does it", () => {
  test("no skill sends a missing thoughts directory to the Cloud pack's setup skill", () => {
    const hits = readdirSync(join(repoRoot, "skills")).flatMap((skill) =>
      prose(skill).flatMap(([file, text]) =>
        text.split("\n").flatMap((line, i) => (/thoughts/i.test(line) && /catalyst-setup/.test(line) ? [`${file}:${i + 1}`] : [])),
      ),
    );
    expect(hits).toEqual([]);
  });
});
