// Frozen pre-change baseline of the process-path reader, copied from worktree-references.mjs as at
// 2027a5c (before CTC-11314). It is the oracle of the differential test and is never edited.
import { lstatSync, readlinkSync } from 'node:fs';
import { dirname, basename, resolve, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';

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
export function words(text) {
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
