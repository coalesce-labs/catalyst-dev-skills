#!/usr/bin/env node
// The runtime is compiled from the pinned @catalyst-cloud/paths commit by Cloud skills.
// CATALYST_PATHS_BUNDLE points to that repository's vendor/paths directory.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
const target = new URL("../vendor-src/scripts/lib/paths/", import.meta.url);
const bundle = process.env.CATALYST_PATHS_BUNDLE;
const provenance = JSON.parse(readFileSync(bundle ? join(bundle, "provenance.json") : new URL("provenance.json", target), "utf8"));
if (provenance.commit !== "c391358d06720985126c15b7fa9d9d6ad1878211") throw new Error("Unexpected paths source commit");
for (const file of ["index.js", "node.js", "legacy-installer.js"]) {
  const bytes = readFileSync(bundle ? join(bundle, file) : new URL(file, target));
  if (createHash("sha256").update(bytes).digest("hex") !== provenance.runtimeSha256[file]) throw new Error(`Runtime hash mismatch: ${file}`);
  if (bundle && !process.argv.includes("--check")) writeFileSync(new URL(file, target), bytes);
  else if (!bytes.equals(readFileSync(new URL(file, target)))) throw new Error(`Runtime drift: ${file}`);
}
if (bundle && !process.argv.includes("--check")) writeFileSync(new URL("provenance.json", target), `${JSON.stringify(provenance, null, 2)}\n`);
