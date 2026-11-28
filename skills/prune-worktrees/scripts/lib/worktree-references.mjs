// Read-only dependency inventories. No shell evaluation and no checkout-level dependencies.
import { accessSync, constants, lstatSync, readlinkSync, readdirSync, statSync } from 'node:fs';
import { dirname, basename, resolve, isAbsolute, join } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { specialKind } from './bounded-read.mjs';

// Resolve symlinks like realpath(3), with lstat and readlink only, so no path is ever opened: a path
// named in a process's arguments can be a named pipe, a device or a cloud placeholder whose open
// never returns. `..` after a link is physical. Errors from lstat (ENOENT, EACCES) propagate.
export function resolveLinks(path) {
  // Not path.resolve, which folds `..` as text before the links are known.
  const pending = (isAbsolute(path) ? path : `${process.cwd()}/${path}`).split('/').filter(Boolean);
  let resolved = '/'; let links = 0;
  while (pending.length) {
    const part = pending.shift();
    if (part === '.') continue;
    if (part === '..') { resolved = dirname(resolved); continue; }
    const next = join(resolved, part);
    const st = lstatSync(next);
    if (st.isSymbolicLink()) {
      if (++links > 40) throw Object.assign(new Error(`ELOOP: too many symbolic links, ${path}`), { code: 'ELOOP' });
      const target = readlinkSync(next);
      if (isAbsolute(target)) resolved = '/';
      pending.unshift(...target.split('/').filter(Boolean));
      continue;
    }
    if (pending.length && !st.isDirectory()) throw Object.assign(new Error(`ENOTDIR: not a directory, ${path}`), { code: 'ENOTDIR' });
    resolved = next;
  }
  return resolved;
}

// CTC-11314: no path the kernel accepts is longer than this (Linux PATH_MAX is 4096 bytes with its NUL,
// macOS's is 1024, and a JS string is never longer than its UTF-8 bytes). A longer value is cut back to
// whole components, which bounds the work of every caller whatever a command line contains.
export const PATH_LIMIT = 4096;
const expandHome = (value, home) => value.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/)/, home);

export function canonicalPath(value, { home = homedir(), cwd } = {}) {
  if (typeof value !== 'string' || !value) return null;
  value = expandHome(value, home);
  if (!isAbsolute(value) && !cwd) return null;
  // The bound measures what a process can hand the kernel: for an absolute value that is the value
  // itself, for a relative one the operand, not the operand joined with the cwd. A bound on the
  // joined path would let a long cwd eat the operand's budget, and the cut could drop its `..` or
  // its tail, releasing a tree that operand still names. A cut keeps whole components, so it never
  // leaves a partial name that could match an unrelated entry; a relative operand with no `/`
  // within the limit has no whole component to keep and is not read as a path at all.
  if (value.length > PATH_LIMIT) {
    const cut = value.lastIndexOf('/', PATH_LIMIT);
    if (isAbsolute(value)) value = cut > 0 ? value.slice(0, cut) : '/';
    else if (cut <= 0) return null;
    else value = value.slice(0, cut);
  }
  // Keep parent components until symlinks are resolved.
  let path = isAbsolute(value) ? value : `${cwd}/${value}`;
  // Resolve .. components one by one, after the links before them.
  if (path.split('/').includes('..')) {
    let current = '/';
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { current = dirname(current); continue; }
      current = join(current, part);
      try { current = resolveLinks(current); } catch { /* retain a missing suffix */ }
    }
    return current;
  }
  const suffix = [];
  while (true) {
    try { return join(resolveLinks(path), ...suffix); } catch { /* absent leaf or inaccessible ancestor */ }
    const parent = dirname(path);
    if (parent === path) return resolve(path, ...suffix);
    suffix.unshift(basename(path)); path = parent;
  }
}

// Preserve quoted operands, split shell operators, and never evaluate substitutions. Each run of
// ordinary characters is appended with one slice, so a huge word never costs a string per character.
const RUN_PLAIN = /[^\\"'\s;|&<>]+/y; const RUN_DOUBLE = /[^"\\]+/y; const RUN_SINGLE = /[^']+/y;
function words(text) {
  const out = []; let word = '', quote = null; let i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '\\' && quote !== "'" && i + 1 < n) { word += text[i + 1]; i += 2; continue; }
    const run = quote === "'" ? RUN_SINGLE : quote === '"' ? RUN_DOUBLE : RUN_PLAIN;
    run.lastIndex = i;
    const m = run.exec(text);
    if (m) { word += m[0]; i += m[0].length; continue; }
    if (quote) { if (c === quote) quote = null; else word += c; }
    else if (c === '"' || c === "'") quote = c;
    else if (/\s|[;|&<>]/.test(c)) { if (word) out.push(word); word = ''; }
    else word += c;
    i++;
  }
  if (word) out.push(word);
  return out;
}

// The paths a flattened ps row can name without quoting. Each path start gets one window that ends
// just before the next path start's slash, or at the first of `"';|<>`; a window is extended past
// that slash only while it resolves completely (a real directory whose name ends in whitespace).
// The windows' components are a prefix of the old rest-of-line candidate's, so the same tree is held,
// and the total length is linear in the line.
const PATH_START = /(?:^|[\s="'])(\/|~\/|\$HOME\/|\$\{HOME\}\/)/g;
const DELIMITER = /["';|<>]/g;
function* pathWindows(arg, home) {
  const starts = [];
  for (const m of arg.matchAll(PATH_START)) {
    const start = m.index + m[0].length - m[1].length;
    starts.push({ start, slash: start + m[1].length - 1 });
  }
  let cut = -1;
  for (let i = 0; i < starts.length; i++) {
    const { start } = starts[i];
    if (cut < start) { DELIMITER.lastIndex = start; const d = DELIMITER.exec(arg); cut = d ? d.index : arg.length; }
    const slashOf = (j) => (j < starts.length && starts[j].slash < cut ? starts[j].slash : cut);
    let next = i + 1; let end = slashOf(next);
    while (end < cut) {
      const window = expandHome(arg.slice(start, end), home);
      if (window.length > PATH_LIMIT) break;
      try { resolveLinks(window); } catch { break; }
      end = slashOf(++next);
    }
    yield arg.slice(start, end);
  }
}

export function argumentPaths(argv, context = {}, seen = new Set()) {
  const result = new Set();
  const add = (value) => {
    value = value.replace(/^(?:--?[\w-]+|[A-Za-z_][\w]*)=/, '');
    if (seen.has(value)) return;
    seen.add(value);
    if ((!value.includes('/') && (!context.cwd || value.startsWith('-'))) || /\$\(|`/.test(value)) return;
    const path = canonicalPath(value, context);
    if (path) result.add(path);
  };
  for (const [index, arg] of argv.entries()) {
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(argv[index - 1] || "") || context.flattened) {
      const tokens = words(arg);
      for (const token of tokens) add(token);
      // Also re-read the words as argv, so a quoted `bash -lc '…'` inside this command is unwrapped too.
      for (const path of argumentPaths(tokens, { ...context, flattened: false }, seen)) result.add(path);
      if (context.flattened) for (const window of pathWindows(arg, context.home ?? homedir())) add(window);
    } else add(arg);
  }
  return [...result];
}
// macOS file systems ignore case, and the resolver keeps the case it was given, so matching folds
// case there. Folding can only add a match, which keeps a tree: the safe direction.
const FOLD_CASE = process.platform === 'darwin';
const fold = (value, foldCase) => (foldCase ? value.toLowerCase() : value);
const contains = (tree, path, foldCase = false) => {
  if (!path) return false;
  const t = fold(tree, foldCase); const p = fold(path, foldCase);
  return p === t || p.startsWith(t + '/');
};
export function referenceReason(tree, snapshot, { foldCase = FOLD_CASE } = {}) {
  const t = canonicalPath(tree);
  return snapshot.references.find(r => contains(t, canonicalPath(r.path), foldCase))?.reason ?? null;
}

// Only a permission refusal means "skip". Any other failure (a dangling link, a file removed since
// the folder was listed) goes on to plutil, whose failure is recorded per file as before.
function readable(path) {
  try { accessSync(path, constants.R_OK); return true; }
  catch (err) { return err.code !== 'EACCES' && err.code !== 'EPERM'; }
}
const runCommand = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
function checked(result, source) {
  if (result.error || result.status !== 0) throw new Error(`${source}: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  return result.stdout;
}
export function collectScheduled({ home = process.env.HOME || homedir(), user = userInfo().username, roots = [
  { path: join(home, 'Library/LaunchAgents'), kind: 'LaunchAgent', user: true },
  { path: '/Library/LaunchAgents', kind: 'LaunchAgent' },
  { path: '/Library/LaunchDaemons', kind: 'LaunchDaemon' },
], run = runCommand } = {}) {
  const snapshot = { references: [], errors: [], diagnostics: [] };
  const add = (path, reason, context) => { const p = canonicalPath(path, context); if (p) snapshot.references.push({ path: p, reason }); };
  for (const root of [...roots].sort((a, b) => a.path.localeCompare(b.path))) {
    let files;
    try { files = readdirSync(root.path).filter(f => f.endsWith('.plist')).sort(); }
    catch (err) {
      if (err.code === 'ENOENT') continue;
      (root.user ? snapshot.errors : snapshot.diagnostics).push(`${root.path}: ${err.message}`); continue;
    }
    for (const file of files) {
      // A named pipe, socket or device is never handed to plutil, which would open it.
      let special = null;
      try { special = specialKind(statSync(join(root.path, file))); } catch { /* plutil reports it as before */ }
      if (special) {
        if (root.user) snapshot.errors.push(`${join(root.path, file)}: a ${special}, not a regular file; never opened`);
        else snapshot.diagnostics.push(`${join(root.path, file)}: a ${special}, not a regular file; skipped, never opened`);
        continue;
      }
      // A system folder can hold a plist only root may read (a VPN helper daemon is mode 0700).
      // Like an unreadable system folder, it is noted and skipped; the user's own folder still fails closed.
      if (!root.user && !readable(join(root.path, file))) {
        snapshot.diagnostics.push(`${join(root.path, file)}: not readable by this user; skipped`); continue;
      }
      try {
        const data = JSON.parse(checked(run('plutil', ['-convert', 'json', '-o', '-', join(root.path, file)]), file));
        if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('invalid plist dictionary');
        const context = { home, cwd: canonicalPath(data.WorkingDirectory, { home }) };
        for (const field of ['Program', 'ProgramArguments', 'WorkingDirectory', 'StandardOutPath', 'StandardErrorPath']) {
          if (data[field] === undefined) continue;
          const values = field === 'ProgramArguments' ? data[field] : [data[field]];
          if (!Array.isArray(values) || values.some(v => typeof v !== 'string')) throw new Error(`invalid ${field}`);
          const reason = `${root.kind} ${typeof data.Label === 'string' ? data.Label : file} (${field})`;
          if (field === 'ProgramArguments') for (const path of argumentPaths(values, context)) add(path, reason, context);
          else for (const path of values) add(path, reason, context);
        }
      } catch (err) { snapshot.errors.push(`${join(root.path, file)}: ${err.message}`); }
    }
  }
  try {
    const result = run('crontab', ['-l']);
    if (result.error?.code === 'ENOENT') snapshot.diagnostics.push('crontab unavailable; current-user cron references cannot be inspected');
    else if (!result.error && result.status !== 0 && /^no crontab for /i.test(String(result.stderr).trim())) { /* normal empty source */ }
    else {
      const text = checked(result, 'crontab -l'); let cronHome = home;
      for (const [index, raw] of text.split('\n').entries()) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const assignment = line.match(/^([A-Za-z_]\w*)\s*=\s*(.*)$/);
        if (assignment) {
          if (assignment[1] === 'HOME') cronHome = canonicalPath(words(assignment[2])[0], { home }) || cronHome;
          continue;
        }
        const match = line.match(/^(?:@\w+\s+|(?:\S+\s+){5})(.+)$/);
        if (!match) { snapshot.errors.push(`crontab line ${index + 1}: malformed entry`); continue; }
        for (const path of argumentPaths(["sh", "-c", match[1]], { home: cronHome, cwd: cronHome }))
          add(path, `crontab ${user} line ${index + 1}: ${line}`, { home: cronHome });
      }
    }
  } catch (err) { snapshot.errors.push(err.message); }
  return snapshot;
}

// A record over this many bytes is outside every case the reader was written for. It is still read in
// full, and also searched as plain text for each tree's path (CTC-11314).
export const RECORD_LIMIT = 65536;
export function recordBytes(record) {
  if (record.bytes === undefined) {
    const argv = record.argv || [];
    let bytes = Math.max(0, argv.length - 1);
    for (const arg of argv) bytes += Buffer.byteLength(arg);
    record.bytes = bytes;
  }
  return record.bytes;
}
// A process-table line the reader could not parse becomes its own record, searched as plain text.
export const unparseableRecord = (source, line, text, afterPid) =>
  ({ pid: null, unparseable: true, source, line, afterPid, argv: [text], flattened: true });

// The needle is present, and the next character is absent or not part of a name, so `wt-a` is found in
// `--paths=/a:wt-a:/b` but not in `wt-ab` or `wt-a-sibling`.
function mentionsAtBoundary(text, needle) {
  if (!needle) return false;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const next = text[at + needle.length];
    if (next === undefined || !/[A-Za-z0-9._-]/.test(next)) return true;
  }
  return false;
}

export function processHolders(tree, records, selfPid = process.pid, { foldCase = FOLD_CASE } = {}) {
  const t = canonicalPath(tree); const holders = new Map();
  const ft = fold(t, foldCase);
  const needles = [...new Set([t, tree].filter(Boolean).map(v => fold(v, foldCase)))];
  for (const record of records) {
    const key = record.unparseable ? `unparsed:${record.source}:${record.line}` : record.pid;
    if (!record.unparseable && record.cwd && contains(t, record.cwdPath ??= canonicalPath(record.cwd), foldCase)) { holders.set(key, { pid: record.pid, argument: false }); continue; }
    if (record.pid === selfPid || holders.has(key)) continue;
    const paths = record.paths ??= argumentPaths(record.argv || [], { cwd: record.cwd, flattened: record.flattened });
    const argv = foldCase ? (record.foldedArgv ??= (record.argv || []).map(arg => arg.toLowerCase())) : (record.argv || []);
    // ps flattens argv. Preserve plausible spaced operands instead of claiming they are safe.
    const named = (record.flattened && argv.some(arg => arg.includes(ft + '/') || arg.includes(ft + ' ')))
      || paths.some(path => contains(t, path, foldCase))
      || (record.unparseable
        ? argv.some(arg => needles.some(needle => needle && arg.includes(needle)))
        : recordBytes(record) > RECORD_LIMIT && argv.some(arg => needles.some(needle => mentionsAtBoundary(arg, needle))));
    if (!named) continue;
    holders.set(key, record.unparseable
      ? { pid: null, argument: false, unparseable: true, source: record.source, line: record.line }
      : { pid: record.pid, argument: true });
  }
  return [...holders.values()];
}

// macOS ps output loses argv boundaries; retain that fact for conservative matching. A line that does
// not start with a pid becomes an unparseable record, named by line number and never by content.
export function processArgumentRows(text) {
  const rows = []; let afterPid = null;
  for (const [index, line] of text.split("\n").entries()) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (match) { afterPid = Number(match[1]); rows.push({ pid: afterPid, argv: [match[2]], flattened: true }); }
    else if (line.trim()) rows.push(unparseableRecord('ps', index + 1, line, afterPid));
  }
  return rows;
}

// Counts for the run report. Records are named by pid, output line and size, never by their text.
export function recordNotes(records, listed = 20) {
  const notes = { oversized: 0, oversizedRecords: [], unparsed: 0, unparsedRecords: [] };
  for (const record of records) {
    if (record.unparseable) {
      notes.unparsed++;
      if (notes.unparsedRecords.length < listed) notes.unparsedRecords.push({ source: record.source, line: record.line, bytes: recordBytes(record), afterPid: record.afterPid });
    } else if (recordBytes(record) > RECORD_LIMIT) {
      notes.oversized++;
      if (notes.oversizedRecords.length < listed) notes.oversizedRecords.push({ pid: record.pid, bytes: recordBytes(record) });
    }
  }
  return notes;
}
