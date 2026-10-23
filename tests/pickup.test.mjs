// pickup.test.mjs — what the pickup skill does with a take's answer, and the verdict it reaches.
//
// Run: bun test tests/pickup.test.mjs
import { describe, test, expect } from "bun:test";

import { leaseOutcome, mentionsTicket, pickupVerdict } from "../skills/pickup/scripts/pickup.mjs";

const DEADLINE = Date.parse("2026-10-23T18:00:00Z");
const row = (over = {}) => ({
  ticket: "PROJ-7",
  holder: "seat:k1:other-agent",
  lastHolder: null,
  generation: 4,
  deadlineMs: DEADLINE,
  hardDeadlineMs: DEADLINE + 3_600_000,
  acquiredAtMs: DEADLINE - 1_800_000,
  lastProgress: null,
  lastProgressAtMs: null,
  ...over,
});

describe("leaseOutcome reads the take's JSON", () => {
  test("a grant is exit 0 and names the previous holder and their last progress", () => {
    const out = leaseOutcome({
      outcome: "taken",
      lease: row({ holder: "seat:k2:me", lastHolder: "seat:k1:gone", lastProgress: "commit:abc (wip)", lastProgressAtMs: DEADLINE - 60_000 }),
      minted: true,
      adopted: [],
    });
    expect(out.code).toBe(0);
    expect(out.lines[0]).toBe("lease: taken, generation 4, live until 2026-10-23T18:00:00.000Z (hard deadline 2026-10-23T19:00:00.000Z)");
    expect(out.lines).toContain("previous holder: seat:k1:gone");
    expect(out.lines).toContain("last progress: commit:abc (wip) at 2026-10-23T17:59:00.000Z");
  });

  test("another holder's live lease is exit 3 and names the holder and the deadline", () => {
    const out = leaseOutcome({
      status: 200,
      outcome: "refused",
      refusal: { reason: "ticket_lease_held", current: row(), occupied: { scope: "ticket" }, retryAtMs: DEADLINE + 1 },
    });
    expect(out.code).toBe(3);
    expect(out.lines[0]).toBe("lease: held by seat:k1:other-agent until 2026-10-23T18:00:00.000Z");
    expect(out.lines).toContain("retry at: 2026-10-23T18:00:00.001Z");
  });

  test("a running phase is exit 3 and names the phase", () => {
    const out = leaseOutcome({
      outcome: "refused",
      refusal: { reason: "phase_lease_held", current: null, occupied: { scope: "phase", phase: "implement", kind: "lease" }, retryAtMs: null },
    });
    expect(out.code).toBe(3);
    expect(out.lines).toEqual(["lease: a running implement phase (lease) occupies the ticket"]);
  });

  test("an HTTP rejection is exit 3 with the status and reason", () => {
    expect(leaseOutcome({ status: 403, outcome: "rejected", reason: "seat_not_on_team" })).toEqual({
      code: 3,
      lines: ["lease: rejected by the cloud (HTTP 403), seat_not_on_team"],
    });
  });

  test("no JSON (the CLI is not connected) is exit 2, never a grant", () => {
    expect(leaseOutcome(null).code).toBe(2);
    expect(leaseOutcome({}).code).toBe(2);
  });
});

describe("pickupVerdict decides continue, restart or done", () => {
  const branch = { name: "PROJ-7-thing", exists: true, head: "a".repeat(40), base: "main", aheadBy: 3 };
  const openPr = { number: 12, state: "OPEN", isDraft: false, mergeable: "MERGEABLE", unresolvedThreads: 0, headSha: "a".repeat(40) };

  test("a merged pull request is done", () => {
    expect(pickupVerdict({ branch, pr: { ...openPr, state: "MERGED" } }).verdict).toBe("done");
  });

  test("a pull request closed without merging is a restart, even with its branch present", () => {
    const v = pickupVerdict({ branch, pr: { ...openPr, state: "CLOSED" } });
    expect(v.verdict).toBe("restart");
    expect(v.reason).toContain("#12 was closed without merging");
  });

  test("no branch is a restart", () => {
    expect(pickupVerdict({ branch: null, pr: null }).verdict).toBe("restart");
  });

  test("a branch with no commits beyond its base and no pull request is a restart", () => {
    expect(pickupVerdict({ branch: { ...branch, aheadBy: 0 }, pr: null }).verdict).toBe("restart");
  });

  test("an open pull request continues, threads and conflicts first, and notes a moved branch", () => {
    const v = pickupVerdict({
      branch,
      pr: { ...openPr, isDraft: true, unresolvedThreads: 2, mergeable: "CONFLICTING" },
      handoff: { path: "thoughts/shared/handoffs/PROJ-7/h.md", recordedHead: "b".repeat(40) },
      otherBranches: ["PROJ-7-old"],
    });
    expect(v.verdict).toBe("continue");
    expect(v.reason).toBe(
      "branch PROJ-7-thing at aaaaaaaaaaaa; pull request #12 open as a draft; 2 unresolved review thread(s) to answer first; " +
        "it conflicts with its base, so merge the base first; the branch moved since the handoff recorded bbbbbbbbbbbb; " +
        "also named by PROJ-7-old",
    );
  });

  test("a branch with work and no pull request continues and says no handoff was found", () => {
    const v = pickupVerdict({ branch, pr: null, handoff: null });
    expect(v).toEqual({
      verdict: "continue",
      reason: "branch PROJ-7-thing at aaaaaaaaaaaa; no pull request yet; no handoff document was found",
    });
  });
});

describe("mentionsTicket never matches a longer id", () => {
  test("PROJ-1 is not PROJ-10, but is found after a PROJ-10", () => {
    expect(mentionsTicket("PROJ-10-thing", "PROJ-1")).toBe(false);
    expect(mentionsTicket("proj-1-thing", "PROJ-1")).toBe(true);
    expect(mentionsTicket("PROJ-10 then PROJ-1", "PROJ-1")).toBe(true);
    expect(mentionsTicket(null, "PROJ-1")).toBe(false);
  });
});
