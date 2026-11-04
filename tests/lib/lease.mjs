// Linux write leases for tests: a regular file whose open() does not return until the lease breaks.
// LEASES is true where python3 can take and drop one (Linux); tests that need it skip elsewhere.
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HELPER = fileURLToPath(new URL("./hold-lease.py", import.meta.url));
export const LEASES = process.platform === "linux" && spawnSync("python3", [HELPER, "--probe"], { stdio: "ignore" }).status === 0;

// holdLease(path) → { release() } once the lease is held. The path goes on stdin and the holder runs
// outside every farm, so a prune's process scan never sees it referencing a tree.
export function holdLease(path) {
  const child = spawn("python3", [HELPER], { cwd: tmpdir(), stdio: ["pipe", "pipe", "inherit"] });
  child.stdin.end(`${path}\n`);
  return new Promise((resolve, reject) => {
    let out = "";
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`lease holder exited ${code} before holding ${path}`)));
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes("lease held")) resolve({ release: () => child.kill("SIGKILL") });
    });
  });
}
