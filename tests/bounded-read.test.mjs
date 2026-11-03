// bounded-read.test.mjs — the prune's bounded reader never opens a special file, and gives up on an
// open that does not return at its deadline, then goes on to the next path.
//
// Run: bun test tests/bounded-read.test.mjs
//
// "An open that does not return" is real here, with no test-only code in the product: a Linux write
// lease (tests/lib/hold-lease.py) makes another process's plain open() of a regular file block until
// the kernel breaks the lease. Those tests skip where leases are unavailable (macOS hosts).

import { test, expect, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boundedProbe, openTimeoutMs } from "../skills/prune-worktrees/scripts/lib/bounded-read.mjs";
import { LEASES, holdLease } from "./lib/lease.mjs";

const t = realpathSync(mkdtempSync(join(tmpdir(), "bounded-read-")));
afterAll(() => rmSync(t, { recursive: true, force: true }));
const reg = `${t}/reg`;
writeFileSync(reg, "hi\n");
const fifo = `${t}/fifo`;
execFileSync("mkfifo", [fifo]);
const sock = `${t}/sock`;
execFileSync("python3", ["-c", "import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])", sock]);

test("regular files are read; missing paths say so", () => {
  expect(boundedProbe([{ op: "read", path: reg }, { op: "read", path: `${t}/nope` }], { timeoutMs: 5000 }))
    .toEqual([{ kind: "file", text: "hi\n" }, expect.objectContaining({ kind: "missing" })]);
  expect(boundedProbe([], { timeoutMs: 5000 })).toEqual([]);
});

test("named pipes, sockets and devices are reported as special and never opened", () => {
  const started = Date.now();
  const r = boundedProbe([{ op: "read", path: fifo }, { op: "open", path: sock }, { op: "open", path: "/dev/null" }], { timeoutMs: 5000 });
  expect(r.map((x) => x.special)).toEqual(["named pipe", "socket", "character device"]);
  expect(Date.now() - started).toBeLessThan(4000); // a FIFO open would block until the deadline
});

test("CATALYST_PRUNE_OPEN_TIMEOUT_S sets the deadline; anything else means 30 s", () => {
  expect(openTimeoutMs({ CATALYST_PRUNE_OPEN_TIMEOUT_S: "2" })).toBe(2000);
  expect(openTimeoutMs({ CATALYST_PRUNE_OPEN_TIMEOUT_S: "1.5" })).toBe(1500);
  for (const v of [undefined, "", "0", "-1", "abc"]) expect(openTimeoutMs({ CATALYST_PRUNE_OPEN_TIMEOUT_S: v })).toBe(30000);
});

test.skipIf(!LEASES)("a regular file whose open does not return is given up on at the deadline, and the next path is still read", async () => {
  const leased = `${t}/leased`;
  writeFileSync(leased, "held\n");
  const lease = await holdLease(leased);
  try {
    const started = Date.now();
    const r = boundedProbe([{ op: "read", path: leased }, { op: "read", path: reg }], { timeoutMs: 1500 });
    expect(r[0]).toEqual({ kind: "abandoned", reason: "open did not return within 1.5s" });
    expect(r[1]).toEqual({ kind: "file", text: "hi\n" });
    const ms = Date.now() - started;
    expect(ms).toBeGreaterThanOrEqual(1500);
    expect(ms).toBeLessThan(8000);
  } finally {
    lease.release();
  }
});
