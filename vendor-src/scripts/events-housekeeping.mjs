#!/usr/bin/env node
// events-housekeeping.mjs — move legacy event history into the resolved events directory, and
// prune monthly event files past a retention (CTC-3788, CTC-3790).
//
//   node events-housekeeping.mjs migrate [--dry-run] [--json]
//   node events-housekeeping.mjs prune   [--keep-months N] [--dry-run] [--json]
//   node events-housekeeping.mjs run     [--keep-months N] [--dry-run] [--json]   # migrate, then prune
//   node events-housekeeping.mjs list    [--json]                                 # every month file, both dirs
//
// The events directory is lib/catalyst-paths.mjs's eventsDir(). The legacy directory is
// legacyEventsDir(), where every laptop wrote before the paths contract.
//
// migrate moves each month older than the current one. The legacy file is first renamed to
// <name>.migrating, which claims it (a legacy directory that cannot be written fails here, before
// any copy). A month present in both directories is merged, legacy lines first, with a newline
// added when the legacy file lacks a final one, into a temporary file that is renamed over the
// destination once its size equals the inputs; only then is the staged file removed. A staged file
// left by a failure never matches an event name again, so no run merges it twice. The current month's legacy file
// stays where it is, because a writer that predates the contract may still be appending to it; the
// next month's run moves it. A second run is a no-op.
//
// prune keeps the current month and the N-1 before it (N from --keep-months, else
// CATALYST_EVENTS_RETENTION_MONTHS, else 6) and deletes older event files in both directories.
// Only files named YYYY-MM.jsonl, YYYY-MM.jsonl.legacy[.<ts>.<pid>[.<n>]] or YYYY-Www.jsonl are candidates; the
// current month is never deleted, whatever the setting.
//
// Exit codes: 0 done, 1 an operation failed (reported, nothing half-done), 2 bad arguments or an
// unresolvable events directory.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eventMonth, eventsDir, legacyEventsDir } from "./lib/catalyst-paths.mjs";

export const DEFAULT_KEEP_MONTHS = 6;
// canonical_jsonl_append rotates a pre-canonical log to YYYY-MM.jsonl.legacy.<timestamp>.<pid>.
// Only that exact suffix matches, so a staged <name>.migrating is never an event file again.
const MONTH_FILE = /^(\d{4})-(\d{2})\.jsonl(\.legacy(\.\d{8}T\d{6}Z\.\d+(\.\d+)?)?)?$/;
const WEEK_FILE = /^(\d{4})-W(\d{2})\.jsonl$/;

// monthOf(name) → "YYYY-MM" for an event file name, or null for anything else. A week file maps
// to the month of the week's Sunday, the latest month it can hold events for, so a week that
// reaches into a kept (or the current) month is kept, and is not migrated while it may be live.
export function monthOf(name) {
  const m = MONTH_FILE.exec(name);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}` : null;
  const w = WEEK_FILE.exec(name);
  if (!w || Number(w[2]) < 1 || Number(w[2]) > 53) return null;
  const jan4 = new Date(Date.UTC(Number(w[1]), 0, 4));
  const sunday = new Date(jan4);
  sunday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 6 + (Number(w[2]) - 1) * 7);
  return eventMonth(sunday);
}

// The oldest month kept: the current month counts as one of the N.
export function cutoffMonth(current, keep) {
  const [y, m] = current.split("-").map(Number);
  const index = y * 12 + (m - 1) - (keep - 1);
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function keepMonths(value, env = process.env) {
  // An explicit value, even an empty one, must be valid; only an unset or empty variable means default.
  const raw = value ?? env.CATALYST_EVENTS_RETENTION_MONTHS;
  if (value === undefined && (raw === undefined || raw === "")) return DEFAULT_KEEP_MONTHS;
  // A safe integer: a long digit string would become Infinity and silently keep everything.
  if (!/^\d+$/.test(String(raw)) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw)))
    throw new Error(`retention must be a whole number of months >= 1, got ${JSON.stringify(raw)}`);
  return Number(raw);
}

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

// The directories event files may live in: the resolved one, and the legacy one when it exists
// and is a different place.
export function eventDirs(env = process.env) {
  const current = eventsDir(env);
  const legacy = legacyEventsDir(env);
  const dirs = [{ dir: current, legacy: false }];
  if (existsSync(legacy) && real(legacy) !== real(current)) dirs.push({ dir: legacy, legacy: true });
  return dirs;
}

function eventFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && monthOf(e.name))
    .map((e) => ({ name: e.name, month: monthOf(e.name), path: join(dir, e.name), bytes: statSync(join(dir, e.name)).size }));
}

// Staged files an interrupted migrate left behind: <event file>.migrating. They are never merged
// again (that could duplicate history), so they are reported until someone checks and restores them.
function strandedFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".migrating") && monthOf(e.name.slice(0, -".migrating".length)))
    .map((e) => ({ name: e.name, path: join(dir, e.name), bytes: statSync(join(dir, e.name)).size, stranded: true }));
}

export function list(env = process.env) {
  return eventDirs(env).flatMap(({ dir, legacy }) => [
    ...eventFiles(dir).map((f) => ({ ...f, legacy })),
    ...strandedFiles(dir).map((f) => ({ ...f, legacy })),
  ]);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

// True when FILE is non-empty and its last byte is not a newline.
function lacksFinalNewline(file) {
  const size = statSync(file).size;
  if (size === 0) return false;
  const fd = openSync(file, "r");
  try {
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, size - 1);
    return b[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

function copyInto(fd, file) {
  const src = openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (let n; (n = readSync(src, buf, 0, buf.length, null)) > 0; ) writeSync(fd, buf, 0, n);
  } finally {
    closeSync(src);
  }
}

// beforeReplace(target) is a test seam: it runs after the copy, before the destination is re-checked.
export function migrate(env = process.env, { dryRun = false, now = new Date(), beforeReplace } = {}) {
  const dest = eventsDir(env);
  const legacy = legacyEventsDir(env);
  const result = { from: legacy, to: dest, moved: [], merged: [], skippedCurrent: [], failed: [] };
  if (!existsSync(legacy) || real(legacy) === real(dest)) return result;
  // A temporary merge file whose run died is only a partial copy: reclaim it.
  if (!dryRun && existsSync(dest)) {
    for (const name of readdirSync(dest)) {
      const m = /\.migrate-(\d+)\.tmp$/.exec(name);
      if (!m || Number(m[1]) === process.pid || alive(Number(m[1]))) continue;
      try {
        unlinkSync(join(dest, name));
        result.reclaimed = [...(result.reclaimed ?? []), name];
      } catch {
        /* reported next run */
      }
    }
  }
  for (const s of strandedFiles(legacy)) {
    const base = s.name.slice(0, -".migrating".length);
    result.failed.push({
      name: s.name,
      error: `left by an interrupted migration; check ${join(dest, base)}, then rename it back to ${base} if its lines are missing there, or delete it`,
    });
  }
  const current = eventMonth(now);
  for (const f of eventFiles(legacy)) {
    if (f.month >= current) {
      result.skippedCurrent.push(f.name);
      continue;
    }
    const target = join(dest, f.name);
    const merge = existsSync(target);
    if (dryRun) {
      (merge ? result.merged : result.moved).push(f.name);
      continue;
    }
    const staged = `${f.path}.migrating`;
    const tmp = `${target}.migrate-${process.pid}.tmp`;
    // A staging file from an interrupted run is the only copy of that history: never rename over it.
    if (existsSync(staged)) {
      result.failed.push({ name: f.name, error: `${staged} already exists from an interrupted migration; resolve it first` });
      continue;
    }
    try {
      mkdirSync(dest, { recursive: true });
      renameSync(f.path, staged);
    } catch (error) {
      result.failed.push({ name: f.name, error: error.message });
      continue;
    }
    let committed = false;
    try {
      const gap = lacksFinalNewline(staged) ? 1 : 0;
      const before = merge ? statSync(target) : null;
      const expected = f.bytes + gap + (before ? before.size : 0);
      // The replacement is at least as private as every input: a merge takes the intersection of
      // both modes, so 0600 records never land in a 0644 file.
      const mode = (statSync(staged).mode & (merge ? statSync(target).mode : 0o777)) & 0o777;
      const fd = openSync(tmp, "wx", mode);
      try {
        copyInto(fd, staged);
        if (gap) writeSync(fd, "\n");
        if (merge) copyInto(fd, target);
      } finally {
        closeSync(fd);
      }
      chmodSync(tmp, mode);
      const got = statSync(tmp).size;
      if (got !== expected) throw new Error(`wrote ${got} bytes, expected ${expected}`);
      // A writer that appended to the destination while it was copied would lose its line to the
      // rename: back out instead, and the next run merges again.
      beforeReplace?.(target);
      if (before) {
        const now = statSync(target);
        if (now.size !== before.size || now.mtimeMs !== before.mtimeMs)
          throw new Error(`${target} changed while it was being merged; left for the next run`);
      }
      renameSync(tmp, target);
      committed = true;
      unlinkSync(staged);
      (merge ? result.merged : result.moved).push(f.name);
    } catch (error) {
      try {
        unlinkSync(tmp);
      } catch {
        /* nothing written */
      }
      if (!committed) {
        try {
          renameSync(staged, f.path);
        } catch {
          /* left as <name>.migrating; never matched again */
        }
      }
      result.failed.push({ name: f.name, error: committed ? `moved, but ${staged} was left behind: ${error.message}` : error.message });
    }
  }
  if (!dryRun) {
    try {
      if (readdirSync(legacy).length === 0) rmdirSync(legacy);
    } catch {
      /* a writer recreated it, or it is not ours to remove */
    }
  }
  return result;
}

export function prune(env = process.env, { keep, dryRun = false, now = new Date() } = {}) {
  const months = keepMonths(keep, env);
  const current = eventMonth(now);
  const cutoff = cutoffMonth(current, months);
  const result = { keepMonths: months, current, oldestKept: cutoff, deleted: [], failed: [], bytesFreed: 0 };
  for (const { dir } of eventDirs(env)) {
    for (const f of eventFiles(dir)) {
      if (f.month >= cutoff || f.month >= current) continue;
      if (!dryRun) {
        try {
          unlinkSync(f.path);
        } catch (error) {
          result.failed.push({ path: f.path, error: error.message });
          continue;
        }
      }
      result.deleted.push(f.path);
      result.bytesFreed += f.bytes;
    }
  }
  return result;
}

function main(argv, env) {
  const [verb, ...rest] = argv;
  const flags = { dryRun: rest.includes("--dry-run"), json: rest.includes("--json") };
  const k = rest.indexOf("--keep-months");
  if (k !== -1) {
    flags.keep = rest[k + 1];
    if (flags.keep === undefined || flags.keep.startsWith("--")) throw new Error("--keep-months needs a number of months");
  }
  // A bad retention refuses before migrate moves anything.
  if (verb === "prune" || verb === "run") flags.keep = keepMonths(flags.keep, env);
  const say = (obj, text) => process.stdout.write(flags.json ? `${JSON.stringify(obj)}\n` : `${text}\n`);
  const tag = flags.dryRun ? " (dry run)" : "";
  let failed = false;
  if (verb === "list") {
    const files = list(env);
    say({ files }, files.map((f) => `${f.path}\t${f.bytes}${f.legacy ? "\tlegacy" : ""}${f.stranded ? "\tSTRANDED" : ""}`).join("\n") || "no event files");
    return 0;
  }
  if (verb === "migrate" || verb === "run") {
    const r = migrate(env, flags);
    failed ||= r.failed.length > 0;
    say(r, `events migrate${tag}: ${r.from} -> ${r.to}: moved ${r.moved.length}, merged ${r.merged.length}, left current ${r.skippedCurrent.length}, failed ${r.failed.length}` +
      r.failed.map((f) => `\n  FAILED ${f.name}: ${f.error}`).join(""));
  }
  if (verb === "prune" || verb === "run") {
    const r = prune(env, { ...flags, keep: flags.keep });
    failed ||= r.failed.length > 0;
    say(r, `events prune${tag}: keep ${r.keepMonths} months (oldest kept ${r.oldestKept}): deleted ${r.deleted.length} file(s), ${r.bytesFreed} bytes` +
      r.deleted.map((p) => `\n  ${flags.dryRun ? "would delete" : "deleted"} ${p}`).join("") +
      r.failed.map((f) => `\n  FAILED ${f.path}: ${f.error}`).join(""));
  }
  if (!["list", "migrate", "prune", "run"].includes(verb)) {
    process.stderr.write("usage: events-housekeeping.mjs migrate|prune|run|list [--keep-months N] [--dry-run] [--json]\n");
    return 2;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`events-housekeeping: ${error.message}\n`);
    process.exitCode = 2;
  }
}
