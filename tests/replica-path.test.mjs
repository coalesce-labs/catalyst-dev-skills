// replica-path.test.mjs — every reader resolves the Catalyst Cloud replica at
// ${CATALYST_REPLICA_DB:-$HOME/.config/catalyst-cloud/replica.db}, and the retired
// ~/catalyst/catalyst-replica.db path appears nowhere except the comments that say it is retired.
//
// Run: bun test tests/replica-path.test.mjs

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { getReplicaDbPath } from "../vendor-src/scripts/execution-core/config.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const saved = { HOME: process.env.HOME, CATALYST_DIR: process.env.CATALYST_DIR, CATALYST_REPLICA_DB: process.env.CATALYST_REPLICA_DB };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("getReplicaDbPath", () => {
  test("defaults to ~/.config/catalyst-cloud/replica.db, whatever CATALYST_DIR says", () => {
    process.env.HOME = "/tmp/replica-path-home";
    process.env.CATALYST_DIR = "/tmp/replica-path-legacy";
    delete process.env.CATALYST_REPLICA_DB;
    expect(getReplicaDbPath()).toBe("/tmp/replica-path-home/.config/catalyst-cloud/replica.db");
  });

  test("CATALYST_REPLICA_DB overrides the default", () => {
    process.env.HOME = "/tmp/replica-path-home";
    process.env.CATALYST_REPLICA_DB = "/tmp/elsewhere/replica.db";
    expect(getReplicaDbPath()).toBe("/tmp/elsewhere/replica.db");
  });
});

// A line may name the retired path only to say it is retired.
const RETIRED = "catalyst-replica.db";
const RETIRED_COMMENT = /retired/i;
const SELF = relative(repoRoot, fileURLToPath(import.meta.url));

function listFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === ".git" || entry === "node_modules") return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

export function retiredPathHits(root) {
  const hits = [];
  for (const file of listFiles(root)) {
    const rel = relative(root, file);
    if (rel === SELF) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, idx) => {
        if (line.includes(RETIRED) && !RETIRED_COMMENT.test(line)) hits.push(`${rel}:${idx + 1}`);
      });
  }
  return hits;
}

describe("the retired replica path", () => {
  test("control: the grep reports a planted reference and passes a retired-path comment", () => {
    const dir = mkdtempSync(join(tmpdir(), "replica-path-"));
    try {
      writeFileSync(join(dir, "a.sh"), "# the retired ~/catalyst/catalyst-replica.db\nDB=~/catalyst/catalyst-replica.db\n");
      expect(retiredPathHits(dir)).toEqual(["a.sh:2"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("appears only in comments that call it retired", () => {
    expect(retiredPathHits(repoRoot)).toEqual([]);
  });
});
