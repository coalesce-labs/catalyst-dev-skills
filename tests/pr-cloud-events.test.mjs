import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const monitoring = "skills/create-pr/references/monitoring-loop.md";

function example(path) {
  return readFileSync(new URL(path, root), "utf8").match(/```bash\n([\s\S]*?)```/)[1];
}

function runExample(path) {
  const dir = mkdtempSync(join(tmpdir(), "pr-cloud-events-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls");
  const script = (name, body) => writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  script("catalyst", `echo "catalyst $*" >> "$CALL_LOG"
if [ "$2" = status ]; then echo '{"head":40,"reachable":true}'; exit 0; fi
touch "$WOKE"
echo '{"sequence":41,"type":"github.pr.merged"}'`);
  script("gh", `echo "gh $*" >> "$CALL_LOG"
if [ "$1" = repo ]; then echo coalesce-labs/example; exit 0; fi
if [ "$3" = --jq ] && [ "$4" = .base.ref ]; then echo main; exit 0; fi
if [[ "$2" = */check-runs ]]; then echo success; exit 0; fi
if [[ "$2" = */comments || "$2" = */reviews ]]; then echo 0; exit 0; fi
if [ -f "$WOKE" ]; then merged=true; else merged=false; fi
printf '{"merged":%s,"state":"open","head":{"sha":"head-1"},"head_sha":"head-1"}\\n' "$merged"`);
  script("sleep", 'echo "sleep $*" >> "$CALL_LOG"; exit 70');
  script("catalyst-events", 'echo "retired CLI" >> "$CALL_LOG"; exit 70');
  try {
    const result = spawnSync("bash", ["-c", example(path)], {
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, CALL_LOG: log, WOKE: join(dir, "woke"), pr_number: "123", ticket: "CTC-1234" },
      encoding: "utf8", timeout: 5000,
    });
    const calls = readFileSync(log, "utf8").trim().split("\n");
    return { ...result, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("create-pr wakes on a cloud merge and confirms it without sleeping", () => {
  const result = runExample(monitoring);
  expect(result.calls).toContain("catalyst events status --json");
  expect(result.status).toBe(0);
  expect(result.calls.some((call) => call.startsWith("catalyst events wait-for "))).toBe(true);
  expect(result.calls.some((call) => call.startsWith("sleep ") || call === "retired CLI")).toBe(false);
  expect(result.stdout).toContain("MERGED");
});
