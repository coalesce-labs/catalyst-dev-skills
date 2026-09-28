// catalyst-paths.mjs — resolve a Catalyst machine path the way packages/paths does (CTC-3787).
//
// Order, for every role: its CATALYST_* variable, then the machine manifest (CATALYST_PATHS_FILE,
// else ${XDG_CONFIG_HOME:-$HOME/.config}/catalyst/paths.json), then the standard default from
// proposeMachinePaths. thoughtsRepo and replicaDb have no default and resolve to undefined. A bad
// variable or manifest throws, as packages/paths does. Nothing here creates a directory.
//
// lib/catalyst-paths.sh is the shell twin; tests/catalyst-paths.test.mjs holds both to one table.
// CLI: node catalyst-paths.mjs <role> — prints the path; exit 2 on a refusal, 3 when unset.
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PATH_ROLES, absolutePath, parseMachinePaths, resolveCatalystPath } from "./paths/index.js";
import { machinePathsFile } from "./paths/node.js";

function present(file) {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

// The standard default for one role, as proposeMachinePaths computes it. Only the inputs that role
// uses are validated, so a bad CATALYST_HOME cannot fail the events default (the shell twin agrees).
function defaultFor(role, env) {
  const home = () => absolutePath(env.HOME, "HOME");
  const base = (name, fallback) => (env[name] !== undefined ? absolutePath(env[name], name) : fallback());
  const catalystHome = () => base("CATALYST_HOME", () => `${home()}/catalyst`);
  const state = () => base("XDG_STATE_HOME", () => `${home()}/.local/state`);
  switch (role) {
    case "repoRoot": return `${catalystHome()}/repos`;
    case "worktrees": return `${catalystHome()}/wt`;
    case "logs": return `${state()}/catalyst/logs`;
    case "events": return `${state()}/catalyst/events`;
    case "state": return `${state()}/catalyst`;
    case "config": return `${base("XDG_CONFIG_HOME", () => `${home()}/.config`)}/catalyst`;
    case "cache": return `${base("XDG_CACHE_HOME", () => `${home()}/.cache`)}/catalyst`;
    case "skills": return `${home()}/.agents/skills`;
    default: return undefined;
  }
}

export function resolveRole(role, env = process.env) {
  if (!Object.hasOwn(PATH_ROLES, role) || role === "artifacts") throw new Error(`paths: unknown role ${role}`);
  if (env[PATH_ROLES[role].variable] !== undefined) return resolveCatalystPath(role, { env });
  const file = machinePathsFile({ env });
  if (file && (env.CATALYST_PATHS_FILE !== undefined || present(file))) {
    let machine;
    try {
      machine = parseMachinePaths(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      throw new Error(`paths: cannot read machine file ${file}: ${error.message}`, { cause: error });
    }
    if (machine.paths[role] !== undefined) return machine.paths[role];
  }
  return defaultFor(role, env);
}

// The monthly event log's directory. CATALYST_DIR/events is the deprecated alias test preloads set
// for isolation (CTL-810); it outranks the manifest so a test that sets only CATALYST_DIR never
// reaches a real machine's log.
export function eventsDir(env = process.env) {
  if (env.CATALYST_EVENTS_DIR === undefined && env.CATALYST_DIR) {
    if (!env.CATALYST_DIR.startsWith("/")) throw new Error("paths: CATALYST_DIR must be an absolute POSIX path");
    return join(env.CATALYST_DIR, "events");
  }
  return resolveRole("events", env);
}

// The pre-contract location. Only migration and history readers use it; nothing writes there.
export function legacyEventsDir(env = process.env) {
  // Never a relative path: with HOME unset, housekeeping would prune under its working directory.
  return join(absolutePath(env.HOME, "HOME"), "catalyst", "events");
}

// UTC month, matching every writer of the monthly log.
export function eventMonth(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const role = process.argv[2];
    const value = role === "events" ? eventsDir() : resolveRole(role);
    if (value === undefined) process.exitCode = 3;
    else process.stdout.write(value);
  } catch (error) {
    process.stderr.write(`catalyst-paths: ${error.message}\n`);
    process.exitCode = 2;
  }
}
