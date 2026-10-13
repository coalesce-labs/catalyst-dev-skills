import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../skills");
const adapter = JSON.parse(readFileSync(resolve(root, "adapter-pstack/stages.json"), "utf8"));
const oneshot = JSON.parse(readFileSync(resolve(root, "ticket-oneshot/stages.json"), "utf8"));

test("pstack maps every phase to the one-shot marker and thoughts contract", () => {
  expect(adapter.playbook).toBe("pstack-oneshot");
  expect(adapter.entry).toBe("poteto-mode");
  expect(adapter.markers).toBe("native");
  expect(adapter.stages.map(({ stage, artifact, thoughts_kind }) => ({ stage, artifact, thoughts_kind })))
    .toEqual(oneshot.stages.map(({ stage, artifact, thoughts_kind }) => ({ stage, artifact, thoughts_kind })));
  for (const row of adapter.stages) {
    expect(row.pstack).toBeTruthy();
    if (row.verify?.startsWith("verify-")) {
      expect(existsSync(resolve(root, "ticket-oneshot/scripts", row.verify))).toBe(true);
    }
  }
});
