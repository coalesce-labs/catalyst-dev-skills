// release-line.test.mjs — the development pack's version is on Catalyst's shared release line.
//
// Run: bun test tests/release-line.test.mjs
import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { acceptedLines, devSkillsTag, lineRefusal, readDeclaration } from "../scripts/check-release-line.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const script = join(repoRoot, "scripts/check-release-line.mjs");
const scratch = mkdtempSync(join(tmpdir(), "release-line-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const aligned = { releaseLine: "0.16", state: "aligned" };
const moving = { releaseLine: "0.17", state: "coordinated", sourceLine: "0.16" };

/** A Cloud pack checkout holding only its release-train.json (a string is written verbatim). */
function cloudPack(label, declaration) {
  const dir = join(scratch, label);
  mkdirSync(dir, { recursive: true });
  if (declaration !== undefined)
    writeFileSync(join(dir, "release-train.json"), typeof declaration === "string" ? declaration : JSON.stringify(declaration));
  return dir;
}
const run = (...args) => spawnSync("node", [script, ...args], { encoding: "utf8" });

describe("lineRefusal", () => {
  test("a version on the declared line passes", () => {
    expect(lineRefusal("0.16.0", aligned)).toBeNull();
    expect(lineRefusal("0.16.12", aligned)).toBeNull();
  });

  test("a version off the line is refused, naming the pack, the version and the line", () => {
    expect(lineRefusal("15.0.1", aligned)).toBe("catalyst-dev-skills@15.0.1 is off release line 0.16");
    expect(lineRefusal("0.17.0", aligned)).toBe("catalyst-dev-skills@0.17.0 is off release line 0.16");
  });

  test("while the train moves, the source line and the new line pass, and nothing else", () => {
    expect(lineRefusal("0.16.3", moving)).toBeNull();
    expect(lineRefusal("0.17.0", moving)).toBeNull();
    expect(lineRefusal("0.15.9", moving)).toBe("catalyst-dev-skills@0.15.9 is off release lines 0.16 and 0.17");
  });

  test("only an exact MAJOR.MINOR.PATCH is a release version", () => {
    for (const v of ["0.16", "v0.16.0", "0.16.0-rc.1", "^0.16.0", "latest"])
      expect(lineRefusal(v, aligned)).toBe(`catalyst-dev-skills version "${v}" is not an exact MAJOR.MINOR.PATCH version`);
  });
});

describe("the declaration", () => {
  test("a declaration with no usable line declares nothing", () => {
    expect(acceptedLines(aligned)).toEqual(["0.16"]);
    expect(acceptedLines(moving)).toEqual(["0.16", "0.17"]);
    expect(acceptedLines({ releaseLine: "0.16", state: "paused" })).toBeNull();
    expect(acceptedLines({ releaseLine: "0.17", state: "coordinated" })).toBeNull();
    expect(acceptedLines({ releaseLine: "16", state: "aligned" })).toBeNull();
  });

  test("it is read from release-train.json in a Cloud pack checkout", () => {
    expect(readDeclaration(cloudPack("read", aligned)).releaseLine).toBe("0.16");
    expect(() => readDeclaration(cloudPack("none"))).toThrow("no release-train.json in");
    expect(() => readDeclaration(cloudPack("lineless", { state: "aligned" }))).toThrow("declares no release line");
  });
});

describe("the command", () => {
  const { version } = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

  test("this checkout is on the 0.16 line (exit 0)", () => {
    const r = run(cloudPack("aligned", aligned));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`catalyst-dev-skills ${version} is on release line 0.16`);
  });

  test("a line this checkout is not on is refused (exit 1)", () => {
    const r = run(cloudPack("later", { releaseLine: "0.18", state: "aligned" }));
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(`catalyst-dev-skills@${version} is off release line 0.18`);
  });

  test("an unreadable declaration is exit 2, never a pass", () => {
    expect(run(cloudPack("missing")).status).toBe(2);
    expect(run(cloudPack("garbled", "{not json")).status).toBe(2);
    expect(run().status).toBe(2);
  });
});

test("CI checks the line against the Cloud pack it already clones", () => {
  const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const clone = ci.indexOf("git clone -q --depth 1 https://github.com/coalesce-labs/catalyst-cloud-skills");
  const check = ci.indexOf('node scripts/check-release-line.mjs "$RUNNER_TEMP/catalyst-cloud-skills"');
  expect(clone).toBeGreaterThan(-1);
  expect(check).toBeGreaterThan(clone);
});

test("a release is tagged dev-skills-v<version>", () => {
  expect(devSkillsTag("0.16.0")).toBe("dev-skills-v0.16.0");
});

test("the README says the version is on the shared line and how a release is tagged", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  expect(readme).toContain("The version is on Catalyst's shared release line");
  expect(readme).toContain("`dev-skills-v<version>`");
  expect(readme).toContain("node scripts/release-tag.mjs <commit> --train <cloud-pack checkout>");
  expect(readme).not.toContain("independent of the Cloud pack's");
});
