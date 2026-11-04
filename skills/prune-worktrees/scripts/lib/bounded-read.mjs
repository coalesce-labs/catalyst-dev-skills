// Bounded file access. A file whose open never returns (a named pipe with no writer, a leased or
// stalled file) must cost one deadline, not the whole run. Special files are never opened at all;
// every other open runs in a short-lived child process that is killed at the deadline.
import { lstatSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHILD = fileURLToPath(new URL("./bounded-read-child.mjs", import.meta.url));
const DEFAULT_MS = 30_000;

// CATALYST_PRUNE_OPEN_TIMEOUT_S, in seconds; a missing, zero, negative or non-numeric value means 30.
export function openTimeoutMs(env = process.env) {
  const s = Number(env.CATALYST_PRUNE_OPEN_TIMEOUT_S);
  return Number.isFinite(s) && s > 0 && String(env.CATALYST_PRUNE_OPEN_TIMEOUT_S).trim() !== "" ? s * 1000 : DEFAULT_MS;
}

export function specialKind(stats) {
  if (stats.isFIFO()) return "named pipe";
  if (stats.isSocket()) return "socket";
  if (stats.isCharacterDevice()) return "character device";
  if (stats.isBlockDevice()) return "block device";
  return null;
}

// The type of a path, from stat or lstat only: never an open.
export function fileKind(path, { follow = true } = {}) {
  let st;
  try { st = follow ? statSync(path) : lstatSync(path); }
  catch (err) { return err.code === "ENOENT" || err.code === "ENOTDIR" ? "missing" : "error"; }
  if (st.isSymbolicLink()) return "symlink";
  if (st.isDirectory()) return "dir";
  if (st.isFile()) return "file";
  return specialKind(st) ?? "error";
}

export const formatSeconds = (ms) => `${Number.isInteger(ms / 1000) ? ms / 1000 : Math.round(ms / 100) / 10}s`;
export const isSpecial = (kind) => ["named pipe", "socket", "character device", "block device"].includes(kind);

// One wording for every note, row reason and unopened[].why, so they cannot drift apart.
export function describeUnopened(result) {
  if (result.kind === "special") return `a ${result.special}, never opened`;
  if (result.kind === "abandoned") return result.reason;
  if (result.kind === "error" || result.kind === "missing") return `could not be read (${result.code || "error"})`;
  return null;
}

// boundedProbe([{ op: 'read' | 'open', path }]) → one result per request, in order:
//   { kind: 'file', text? } | { kind: 'dir' } | { kind: 'missing', code } | { kind: 'special', special }
//   | { kind: 'error', code, message } | { kind: 'abandoned', reason }
// The child writes `S <i>` before it touches request i and `D <i> <json>` after. When it is killed at
// the deadline, the request in flight is abandoned and the rest run again in a new child, each with
// a fresh deadline.
export function boundedProbe(requests, { timeoutMs = openTimeoutMs() } = {}) {
  const results = new Array(requests.length).fill(null);
  let next = 0;
  while (next < requests.length) {
    const batch = requests.slice(next).map((r, i) => ({ i: next + i, op: r.op, path: r.path }));
    const spawnedAt = Date.now();
    const r = spawnSync(process.execPath, [CHILD], {
      input: JSON.stringify(batch), encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 256 * 1024 * 1024,
    });
    // Only the deadline means "did not return". A child killed for another reason (the OOM killer,
    // a crash, too much output) before the deadline is an error, named by its signal or code.
    const deadlinePassed = r.error?.code === "ETIMEDOUT" || (Boolean(r.signal) && !r.error && Date.now() - spawnedAt >= timeoutMs);
    let started = null;
    for (const line of String(r.stdout || "").split("\n")) {
      const s = /^S (\d+)$/.exec(line);
      if (s) { started = Number(s[1]); continue; }
      const d = /^D (\d+) (.*)$/.exec(line);
      if (d) {
        try { results[Number(d[1])] = JSON.parse(d[2]); } catch { /* torn line: re-run below */ }
      }
    }
    if (started === null) {
      // The reader never reached its first request: it could not start, so retrying per path cannot help.
      const why = deadlinePassed ? `reader did not start within ${formatSeconds(timeoutMs)}`
        : `reader could not start: ${r.error?.message || String(r.stderr || "").trim().split("\n")[0] || `exit ${r.status}`}`;
      for (let i = next; i < requests.length; i++) results[i] ??= { kind: "abandoned", reason: why };
      break;
    }
    if (results[started] === null) {
      results[started] = deadlinePassed
        ? { kind: "abandoned", reason: `open did not return within ${formatSeconds(timeoutMs)}` }
        : { kind: "error", code: r.error?.code || r.signal || "EREADER",
          message: r.error?.message || (r.signal ? `reader killed by ${r.signal}` : "") || String(r.stderr || "").trim().split("\n")[0] || `reader exit ${r.status}` };
    }
    next = started + 1;
    while (next < requests.length && results[next] !== null) next++;
  }
  return results;
}
