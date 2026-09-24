#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check")) {
  console.error("usage: node scripts/sync-plugin-version.mjs [--check]");
  process.exit(2);
}

const packageUrl = new URL("../package.json", import.meta.url);
const pluginUrl = new URL("../.claude-plugin/plugin.json", import.meta.url);
const packageVersion = JSON.parse(readFileSync(packageUrl, "utf8")).version;
const plugin = JSON.parse(readFileSync(pluginUrl, "utf8"));

if (!packageVersion || typeof packageVersion !== "string") {
  console.error("package.json needs a version");
  process.exit(1);
}
if (plugin.version === packageVersion) {
  console.log(`development pack and Claude plugin both use ${packageVersion}`);
  process.exit(0);
}
if (args.includes("--check")) {
  console.error(`plugin ${plugin.version} differs from development pack ${packageVersion}; run npm run version:sync`);
  process.exit(1);
}

plugin.version = packageVersion;
writeFileSync(pluginUrl, `${JSON.stringify(plugin, null, 2)}\n`);
console.log(`Claude plugin set to ${packageVersion}`);
