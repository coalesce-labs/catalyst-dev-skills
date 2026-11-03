// Read-only dependency inventories. No shell evaluation and no checkout-level dependencies.
import { accessSync, constants, lstatSync, readlinkSync, readdirSync, statSync } from 'node:fs';
import { dirname, basename, resolve, isAbsolute, join } from 'node:path';
import { homedir, userInfo } from 'node:os';
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

export function canonicalPath(value, { home = homedir(), cwd } = {}) {
  if (typeof value !== 'string' || !value) return null;
  value = value.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/)/, home);
  if (!isAbsolute(value) && !cwd) return null;
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

// Preserve quoted operands, split shell operators, and never evaluate substitutions.
function words(text) {
  const out = []; let word = '', quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && quote !== "'" && i + 1 < text.length) { word += text[++i]; continue; }
    if (quote) { if (c === quote) quote = null; else word += c; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (/\s|[;|&<>]/.test(c)) { if (word) out.push(word); word = ''; } else word += c;
  }
  if (word) out.push(word);
  return out;
}
export function argumentPaths(argv, context = {}) {
  const result = new Set();
  const add = (value) => {
    value = value.replace(/^(?:--?[\w-]+|[A-Za-z_][\w]*)=/, '');
    if ((!value.includes('/') && (!context.cwd || value.startsWith('-'))) || /\$\(|`/.test(value)) return;
    const path = canonicalPath(value, context);
    if (path) result.add(path);
  };
  for (const [index, arg] of argv.entries()) {
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(argv[index - 1] || "") || context.flattened) {
      const tokens = words(arg);
      for (const token of tokens) add(token);
      // Also re-read the words as argv, so a quoted `bash -lc '…'` inside this command is unwrapped too.
      for (const path of argumentPaths(tokens, { ...context, flattened: false })) result.add(path);
      if (context.flattened) {
        for (const match of arg.matchAll(/(?:^|[\s="'])(\/|~\/|\$HOME\/|\$\{HOME\}\/)/g)) {
          const start = match.index + match[0].length - match[1].length;
          add(arg.slice(start).replace(/["';|<>].*$/, ""));
        }
      }
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

export function processHolders(tree, records, selfPid = process.pid, { foldCase = FOLD_CASE } = {}) {
  const t = canonicalPath(tree); const holders = new Map();
  for (const record of records) {
    if (record.cwd && contains(t, record.cwdPath ??= canonicalPath(record.cwd), foldCase)) { holders.set(record.pid, { pid: record.pid, argument: false }); continue; }
    if (record.pid === selfPid || holders.has(record.pid)) continue;
    const paths = record.paths ??= argumentPaths(record.argv || [], { cwd: record.cwd, flattened: record.flattened });
    // ps flattens argv. Preserve plausible spaced operands instead of claiming they are safe.
    const ft = fold(t, foldCase);
    const flattened = record.flattened && (record.argv || []).some(arg => fold(arg, foldCase).includes(ft + '/') || fold(arg, foldCase).includes(ft + ' '));
    if (flattened || paths.some(path => contains(t, path, foldCase))) holders.set(record.pid, { pid: record.pid, argument: true });
  }
  return [...holders.values()];
}

// macOS ps output loses argv boundaries; retain that fact for conservative matching.
export function processArgumentRows(text) {
  return text.split("\n").flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    return match ? [{ pid: Number(match[1]), argv: [match[2]], flattened: true }] : [];
  });
}
