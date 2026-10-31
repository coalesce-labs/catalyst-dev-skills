// Read-only dependency inventories. No shell evaluation and no checkout-level dependencies.
import { realpathSync, readdirSync } from 'node:fs';
import { dirname, basename, resolve, isAbsolute, join } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { spawnSync } from 'node:child_process';

export function canonicalPath(value, { home = homedir(), cwd } = {}) {
  if (typeof value !== 'string' || !value) return null;
  value = value.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/)/, home);
  if (!isAbsolute(value) && !cwd) return null;
  // Keep parent components until realpath has resolved symlinks.
  let path = isAbsolute(value) ? value : `${cwd}/${value}`;
  // Bun may normalize .. before realpath too, so resolve those components one by one.
  if (path.split('/').includes('..')) {
    let current = '/';
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { current = dirname(current); continue; }
      current = join(current, part);
      try { current = realpathSync(current); } catch { /* retain a missing suffix */ }
    }
    return current;
  }
  const suffix = [];
  while (true) {
    try { return join(realpathSync(path), ...suffix); } catch { /* absent leaf or inaccessible ancestor */ }
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
      for (const token of words(arg)) add(token);
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
const contains = (tree, path) => path === tree || path.startsWith(tree + '/');
export function referenceReason(tree, snapshot) {
  const t = canonicalPath(tree);
  return snapshot.references.find(r => contains(t, canonicalPath(r.path)))?.reason ?? null;
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

export function processHolders(tree, records, selfPid = process.pid) {
  const t = canonicalPath(tree); const holders = new Map();
  for (const record of records) {
    if (record.cwd && contains(t, canonicalPath(record.cwd))) { holders.set(record.pid, { pid: record.pid, argument: false }); continue; }
    if (record.pid === selfPid || holders.has(record.pid)) continue;
    const paths = record.paths ??= argumentPaths(record.argv || [], { cwd: record.cwd, flattened: record.flattened });
    // ps flattens argv. Preserve plausible spaced operands instead of claiming they are safe.
    const flattened = record.flattened && (record.argv || []).some(arg => arg.includes(t + '/') || arg.includes(t + ' '));
    if (flattened || paths.some(path => contains(t, path))) holders.set(record.pid, { pid: record.pid, argument: true });
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
