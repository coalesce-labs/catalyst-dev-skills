// CTC-3020: the CLI and agent readers consume the same versioned paths contract.
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMachinePaths, resolveCatalystPath } from "./paths/index.js";
import { machinePathsFile } from "./paths/node.js";
function present(file) {
  try { lstatSync(file); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}
export function getReplicaDbPath(env = process.env) {
  if (env.CATALYST_REPLICA_DB !== undefined) return resolveCatalystPath("replicaDb", { env });
  const home = env.CATALYST_SKILLS_HOME ?? env.HOME;
  const file = machinePathsFile({ env: { ...env, HOME: home } });
  if (file && (env.CATALYST_PATHS_FILE !== undefined || present(file))) {
    const machine = parseMachinePaths(JSON.parse(readFileSync(file, "utf8")));
    return resolveCatalystPath("replicaDb", { env, machine });
  }
  // Compatibility before paths setup, including the writer's saved custom database.
  const config = join(home, ".config/catalyst-cloud");
  const customer = join(config, "customer.json");
  const cfg = present(customer) ? JSON.parse(readFileSync(customer, "utf8")) : {};
  return resolveCatalystPath("replicaDb", { overrides: { replicaDb: cfg.replicaDb ?? join(config, "replica.db") } });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(getReplicaDbPath()); }
  catch (error) { process.stderr.write(`[replica-path] ${error.message}\n`); process.exitCode = 2; }
}
