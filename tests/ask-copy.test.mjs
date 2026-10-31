// ask-copy.test.mjs — the ask verb's wording checks, read from vendor-src (the operator pack vendors
// them). The agent-decidable cases are the titles of real asks that reached a person although a
// second agent could have decided them.
//
// Run: bun test tests/ask-copy.test.mjs

import { describe, test, expect } from "bun:test";
import { askCopyFindings } from "../vendor-src/scripts/lib/ask-copy.mjs";

const rules = (text) => askCopyFindings(text).map((f) => f.rule);

describe("askCopyFindings: agent-decidable", () => {
  test.each([
    "may the change_log query plan test assert PRIMARY KEY",
    "Approve the runs dashboard test changes",
    "May the change update the existing contract and table inventory tests to match",
    "May the change update the two reviewed test inventories without changing what they protect",
    "Allow the change to update the three reviewed inventory tests it requires",
    "May the writer change this test's expectation from 3 to 4?",
    "Lift the fence now?",
    "Take the preview label off?",
    "Pick between the two equivalent implementations",
  ])("flags %p", (text) => {
    expect(rules(text)).toEqual(["agent-decidable"]);
  });

  test("names who decides and when the human still hears of it", () => {
    const [f] = askCopyFindings("May the writer change this test's expectation?");
    expect(f.fix).toContain("A second agent that did not write the change decides this kind");
    expect(f.fix).toContain("removes a protection with no replacement");
  });

  test.each([
    "This pull request is blocked by one failing required check. All the other checks pass and all the tests pass.",
    "Publishing is a public release, and public releases need your go.",
    "We create the flag at shadow when you say yes.",
    "May we ship the release on Monday?",
  ])("passes %p", (text) => {
    expect(rules(text)).toEqual([]);
  });

  test("the earlier rules still fire beside it", () => {
    expect(rules("Only you can lift the fence.")).toEqual(["only-you", "agent-decidable"]);
  });
});
