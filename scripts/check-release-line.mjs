#!/usr/bin/env node
// check-release-line.mjs — the development pack's version is on Catalyst's shared release line.
//
// The line is declared once, in `release-train.json`, which the Cloud pack carries
// (coalesce-labs/catalyst-cloud-skills). This reads that declaration from a checkout passed as the
// argument and refuses a package.json version whose MAJOR.MINOR is off it. While the train moves
// (`state: coordinated`), the old line (`sourceLine`) is accepted too.
//
// Run: node scripts/check-release-line.mjs <cloud-pack-checkout>   (exit 1 off the line, 2 unread)

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACK = "catalyst-dev-skills";
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const LINE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The tag a release of this pack carries. */
export const devSkillsTag = (version) => `dev-skills-v${version}`;
export const lineOf = (version) => version.split(".").slice(0, 2).join(".");
export const exactVersion = (value) => typeof value === "string" && STABLE_VERSION.test(value);

/** Negative when `a` is older, 0 when equal, positive when newer. */
export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** The lines a declaration accepts, or null when it declares none. */
export function acceptedLines(declaration) {
  if (!declaration || !LINE.test(declaration.releaseLine ?? "")) return null;
  if (declaration.state === "aligned") return [declaration.releaseLine];
  if (declaration.state === "coordinated" && LINE.test(declaration.sourceLine ?? ""))
    return [declaration.sourceLine, declaration.releaseLine];
  return null;
}

/** null when `version` is on a line the declaration accepts, else the refusal. */
export function lineRefusal(version, declaration) {
  if (!exactVersion(version))
    return `${PACK} version ${JSON.stringify(version)} is not an exact MAJOR.MINOR.PATCH version`;
  const lines = acceptedLines(declaration);
  if (lines.includes(lineOf(version))) return null;
  return `${PACK}@${version} is off release line${lines.length > 1 ? "s" : ""} ${lines.join(" and ")}`;
}

/** The declaration in a Cloud pack checkout. Throws when it is missing or declares no line. */
export function readDeclaration(checkout) {
  const file = join(checkout, "release-train.json");
  if (!existsSync(file)) throw new Error(`no release-train.json in ${checkout}`);
  const declaration = JSON.parse(readFileSync(file, "utf8"));
  if (acceptedLines(declaration) === null) throw new Error(`${file} declares no release line`);
  return declaration;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("usage: node scripts/check-release-line.mjs <cloud-pack-checkout>");
    process.exit(2);
  }
  let declaration;
  try {
    declaration = readDeclaration(args[0]);
  } catch (error) {
    console.error(`release line unread: ${error.message}`);
    process.exit(2);
  }
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const refusal = lineRefusal(version, declaration);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  console.log(`${PACK} ${version} is on release line ${lineOf(version)}`);
}
