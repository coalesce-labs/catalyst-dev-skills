// ask-audience.test.mjs — a review ask names who should answer it. CTC-4229.
//
// Run: bun test tests/ask-audience.test.mjs
//
// The audience line sits after the default, outside the options block, so the decision trigger
// reads the same options with or without it.

import { describe, test, expect } from "bun:test";
import {
  buildAskBody,
  parseAskOptions,
  verifyAskBody,
  REVIEW_AUDIENCES,
} from "../skills/ask/scripts/ask.mjs";

const OPTIONS = ["Approve the design", "Approve with the changes in my reply", "Rework the design"];
const base = {
  why: "CTC-9001 changes the Waiting on me page. The design is in the plan document.",
  options: OPTIONS,
  defaultIfSilent: "The ticket stays held until someone answers.",
  blocks: ["CTC-9001"],
};

describe("buildAskBody with an audience", () => {
  test("renders one Review audience line after the default", () => {
    const body = buildAskBody({ ...base, audience: ["ux", "product"] });
    expect(body).toContain("**Review audience:** ux, product");
    expect(body.indexOf("**Default if silent:**")).toBeLessThan(
      body.indexOf("**Review audience:**"),
    );
  });

  test("the options still parse and round-trip exactly", () => {
    const body = buildAskBody({ ...base, audience: ["devex"] });
    expect(parseAskOptions(body)).toEqual(OPTIONS);
    expect(verifyAskBody({ intendedOptions: OPTIONS, storedBody: body }).ok).toBe(true);
  });

  test("control: with no audience the body is unchanged", () => {
    expect(buildAskBody({ ...base, audience: [] })).toBe(buildAskBody(base));
    expect(buildAskBody(base)).not.toContain("Review audience");
  });

  test("names the four surfaces and the two co-reviewers", () => {
    expect(REVIEW_AUDIENCES).toEqual(["ux", "devex", "agentx", "data_ai", "product", "infra"]);
  });
});
