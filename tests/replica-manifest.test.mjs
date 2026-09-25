import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
function manifest(home, replicaDb) {
  const file = join(home, ".config/catalyst/paths.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: 1, paths: {
    repoRoot: `${home}/repos`, worktrees: `${home}/wt`, logs: `${home}/logs`, events: `${home}/events`,
    config: `${home}/.config/catalyst-cloud`, cache: `${home}/cache`, state: `${home}/state`, skills: `${home}/skills`,
    ...(replicaDb ? { replicaDb } : {}),
  }, provenance: {} }));
}
test("shell and JavaScript readers use the declared replica", () => {
  const home = mkdtempSync(join(tmpdir(), "reader-manifest-"));
  try {
    manifest(home, `${home}/selected.db`);
    const env = { ...process.env, HOME: home };
    delete env.CATALYST_REPLICA_DB; delete env.CATALYST_PATHS_FILE; delete env.XDG_CONFIG_HOME;
    const shell = spawnSync("bash", ["-c", 'source "$1"; printf "%s" "$CATALYST_REPLICA_DB"', "test", `${root}/vendor-src/scripts/lib/linear-read-replica.sh`], { env, encoding: "utf8" });
    expect(shell.status).toBe(0);
    expect(shell.stdout).toBe(`${home}/selected.db`);
    const js = spawnSync("node", ["--input-type=module", "-e", `import { getReplicaDbPath } from ${JSON.stringify(`${root}/vendor-src/scripts/execution-core/config.mjs`)}; process.stdout.write(getReplicaDbPath());`], { env, encoding: "utf8" });
    expect(js.status).toBe(0);
    expect(js.stdout).toBe(`${home}/selected.db`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a shell-local replica override stays authoritative", () => {
  const home = mkdtempSync(join(tmpdir(), "reader-override-"));
  try {
    manifest(home, `${home}/manifest.db`);
    const env = { ...process.env, HOME: home };
    delete env.CATALYST_REPLICA_DB; delete env.CATALYST_PATHS_FILE; delete env.XDG_CONFIG_HOME;
    const result = spawnSync("bash", ["-c", 'CATALYST_REPLICA_DB="$2"; source "$1"; printf "%s" "$CATALYST_REPLICA_DB"', "test", `${root}/vendor-src/scripts/lib/linear-read-replica.sh`, `${home}/explicit.db`], { env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${home}/explicit.db`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the freshness gate follows a replacement lock at the selected database", async () => {
  const { unlinkSync, utimesSync } = await import("node:fs");
  const home = mkdtempSync(join(tmpdir(), "reader-lock-"));
  try {
    const db = `${home}/selected.db`;
    manifest(home, db);
    const create = spawnSync("sqlite3", [db, "CREATE TABLE sync_meta(key TEXT, value TEXT); INSERT INTO sync_meta VALUES('cursor','87654321');"], { encoding: "utf8" });
    expect(create.status).toBe(0);
    const env = { ...process.env, HOME: home };
    delete env.CATALYST_REPLICA_DB; delete env.CATALYST_PATHS_FILE; delete env.XDG_CONFIG_HOME;
    const fresh = () => spawnSync("bash", ["-c", 'source "$1" && replica_fresh', "test", `${root}/vendor-src/scripts/lib/linear-read-replica.sh`], { env, encoding: "utf8" }).status;
    writeFileSync(`${db}.writer.lock`, "stale");
    utimesSync(`${db}.writer.lock`, new Date(0), new Date(0));
    expect(fresh()).toBe(1);
    unlinkSync(`${db}.writer.lock`);
    writeFileSync(`${db}.writer.lock`, "new writer");
    expect(fresh()).toBe(0);
    expect(spawnSync("sqlite3", [db, "SELECT value FROM sync_meta WHERE key='cursor';"], { encoding: "utf8" }).stdout.trim()).toBe("87654321");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("invalid and replica-free manifests cannot silently select the legacy database", () => {
  const home = mkdtempSync(join(tmpdir(), "reader-invalid-"));
  try {
    const env = { ...process.env, HOME: home };
    delete env.CATALYST_REPLICA_DB; delete env.CATALYST_PATHS_FILE; delete env.XDG_CONFIG_HOME;
    const resolve = () => spawnSync("bash", ["-c", 'source "$1"', "test", `${root}/vendor-src/scripts/lib/linear-read-replica.sh`], { env, encoding: "utf8" });
    manifest(home);
    expect(resolve().status).toBe(2);
    writeFileSync(`${home}/.config/catalyst/paths.json`, '{"version":99}');
    const invalid = resolve();
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).toContain("unsupported machine record version");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the checked-in canonical runtime matches its generation hashes", () => {
  const result = spawnSync("node", [`${root}/scripts/vendor-paths.mjs`, "--check"], { encoding: "utf8" });
  expect(result.status).toBe(0);
});
