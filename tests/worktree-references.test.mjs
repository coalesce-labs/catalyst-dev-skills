import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, realpathSync, symlinkSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { PATH_LIMIT, RECORD_LIMIT, recordNotes } from '../skills/prune-worktrees/scripts/lib/worktree-references.mjs';
import * as before from './lib/worktree-references-before.mjs';
import { canonicalPath, argumentPaths, collectScheduled, referenceReason, processHolders, processArgumentRows, resolveLinks } from '../skills/prune-worktrees/scripts/lib/worktree-references.mjs';

const mkfifo = (path) => execFileSync('mkfifo', [path]);
// A bound unix socket file; python3 exits and leaves it behind.
const mksock = (path) => execFileSync('python3', ['-c', 'import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])', path]);

test('aliases resolve missing suffixes and enforce path boundaries', () => {
  const t = mkdtempSync(join(tmpdir(), 'references-'));
  try {
    mkdirSync(`${t}/real`); symlinkSync(`${t}/real`, `${t}/alias`);
    expect(canonicalPath(`${t}/alias/missing/log`)).toBe(`${t}/real/missing/log`);
    expect(referenceReason(`${t}/real`, { references: [{ path: `${t}/alias/missing`, reason: 'job' }] })).toBe('job');
    expect(referenceReason(`${t}/real`, { references: [{ path: `${t}/real-sibling/x`, reason: 'bad' }] })).toBeNull();
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('shell extraction handles quoting, redirects, equals and home without execution', () => {
  expect(argumentPaths(['bash', '-c', 'cat "~/tree with spaces/job" >$HOME/tree/out --file=${HOME}/tree/in'], { home: '/home/u' })).toEqual(expect.arrayContaining(['/home/u/tree with spaces/job', '/home/u/tree/out', '/home/u/tree/in']));
  expect(argumentPaths(['sh', '-c', 'cat /tree\\ with\\ spaces/job'], {})).toContain('/tree with spaces/job');
  expect(argumentPaths(['./job'], { cwd: '/tree', home: '/home/u' })).toContain('/tree/job');
  expect(argumentPaths(['./job'], { home: '/home/u' })).toEqual([]);
});

test('plist fields, XML and binary adapter, cron HOME and provenance', () => {
  const t = mkdtempSync(join(tmpdir(), 'scheduler-'));
  try {
    const root = `${t}/agents`; mkdirSync(root);
    writeFileSync(`${root}/a.plist`, '<?xml version="1.0"?><plist><dict/></plist>');
    writeFileSync(`${root}/b.plist`, Buffer.from('bplist00fixture'));
    const calls = [];
    const run = (cmd, args) => {
      calls.push([cmd, args]);
      return cmd === 'plutil' ? { status: 0, stdout: JSON.stringify({ Label: 'dev.job', WorkingDirectory: '/tree', Program: '/tree/bin', ProgramArguments: ['bash', './job'], StandardOutPath: '/tree/out', StandardErrorPath: '/tree/err', Unrelated: '/control/x' }) } : { status: 0, stdout: '# ignored\nHOME=/cron\n@hourly ./tree/job\n* * * * * /tree/job\n' };
    };
    const snapshot = collectScheduled({ home: t, user: 'ryan', roots: [{ path: root, kind: 'LaunchAgent', user: true }], run });
    expect(snapshot.errors).toEqual([]);
    for (const field of ['Program', 'ProgramArguments', 'WorkingDirectory', 'StandardOutPath', 'StandardErrorPath']) expect(snapshot.references.some(r => r.reason === `LaunchAgent dev.job (${field})`)).toBe(true);
    expect(referenceReason('/control', snapshot)).toBeNull();
    expect(referenceReason('/cron/tree', snapshot)).toBe('crontab ryan line 3: @hourly ./tree/job');
    expect(calls[0][1]).toEqual(['-convert', 'json', '-o', '-', `${root}/a.plist`]);
    expect(calls.at(-1)).toEqual(['crontab', ['-l']]);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('source absence differs from unexpected failure and malformed plists', () => {
  const run = () => ({ error: Object.assign(new Error('missing'), { code: 'ENOENT' }) });
  expect(collectScheduled({ roots: [], run }).errors).toEqual([]);
  expect(collectScheduled({ roots: [], run }).diagnostics.length).toBe(1);
  expect(collectScheduled({ roots: [], run: () => ({ status: 1, stderr: 'no crontab for user' }) }).errors).toEqual([]);
  expect(collectScheduled({ roots: [], run: () => ({ status: 1, stderr: 'denied' }) }).errors.length).toBe(1);
});

test('process absolute arguments work without cwd, aliases and flattened spaced paths', () => {
  expect(processHolders('/tree with spaces', [{ pid: 123, argv: ['bash /tree with spaces/job'], flattened: true }], 999)).toEqual([{ pid: 123, argument: true }]);
  expect(processHolders('/tree', [{ pid: 123, argv: ['/tree/job'] }], 999)).toEqual([{ pid: 123, argument: true }]);
  expect(processHolders('/tree', [{ pid: 999, argv: ['/tree/job'] }], 999)).toEqual([]);
});

test('malformed conversion, timeout, user directory errors and system readability policies', () => {
  const t = mkdtempSync(join(tmpdir(), 'scheduler-errors-'));
  try {
    writeFileSync(`${t}/not-directory`, 'x');
    const empty = () => ({ status: 1, stderr: 'no crontab for user' });
    expect(collectScheduled({ roots: [{ path: `${t}/not-directory`, user: true }], run: empty }).errors.length).toBe(1);
    expect(collectScheduled({ roots: [{ path: `${t}/not-directory` }], run: empty }).diagnostics.length).toBe(1);
    mkdirSync(`${t}/agents`); writeFileSync(`${t}/agents/a.plist`, 'malformed');
    for (const result of [{ status: 0, stdout: 'not json' }, { status: 0, stdout: '{"ProgramArguments":42}' }, { status: null, error: new Error('timed out') }]) {
      const snapshot = collectScheduled({ roots: [{ path: `${t}/agents`, kind: 'LaunchDaemon' }], run: cmd => cmd === 'plutil' ? result : empty() });
      expect(snapshot.errors.length).toBe(1);
    }
    expect(collectScheduled({ roots: [], run: () => ({ error: new Error('timeout') }) }).errors.length).toBe(1);
    const result = collectScheduled({ roots: [{ path: `${t}/agents`, kind: 'LaunchDaemon' }], run: cmd => cmd === 'plutil' ? { status: 0, stdout: '{"Program":"/tree/job"}' } : empty() });
    expect(referenceReason('/tree', result)).toBe('LaunchDaemon a.plist (Program)');
  } finally { rmSync(t, { recursive: true, force: true }); }
});

const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

test.skipIf(asRoot)('a system plist only root can read is noted and skipped, and the rest still counts', () => {
  const t = mkdtempSync(join(tmpdir(), 'scheduler-unreadable-'));
  try {
    const root = `${t}/daemons`; mkdirSync(root);
    writeFileSync(`${root}/a-root-only.plist`, 'x'); chmodSync(`${root}/a-root-only.plist`, 0o000);
    writeFileSync(`${root}/b-readable.plist`, 'x');
    const seen = [];
    const run = (cmd, args) => {
      if (cmd !== 'plutil') return { status: 1, stderr: 'no crontab for user' };
      seen.push(args.at(-1));
      return { status: 0, stdout: '{"Label":"dev.daemon","Program":"/tree/job"}' };
    };
    const snapshot = collectScheduled({ roots: [{ path: root, kind: 'LaunchDaemon' }], run });
    expect(snapshot.errors).toEqual([]);
    expect(snapshot.diagnostics).toEqual([`${root}/a-root-only.plist: not readable by this user; skipped`]);
    expect(seen).toEqual([`${root}/b-readable.plist`]);
    expect(referenceReason('/tree', snapshot)).toBe('LaunchDaemon dev.daemon (Program)');
  } finally { chmodSync(`${t}/daemons/a-root-only.plist`, 0o600); rmSync(t, { recursive: true, force: true }); }
});

test('a dangling plist link in a system folder is recorded as a scan error, not thrown', () => {
  const t = mkdtempSync(join(tmpdir(), 'scheduler-dangling-'));
  try {
    const root = `${t}/daemons`; mkdirSync(root);
    symlinkSync(`${t}/gone.plist`, `${root}/a-dangling.plist`);
    writeFileSync(`${root}/b-readable.plist`, 'x');
    const run = (cmd, args) => {
      if (cmd !== 'plutil') return { status: 1, stderr: 'no crontab for user' };
      if (!existsSync(args.at(-1))) return { status: 1, stderr: 'file does not exist' };
      return { status: 0, stdout: '{"Label":"dev.daemon","Program":"/tree/job"}' };
    };
    const snapshot = collectScheduled({ roots: [{ path: root, kind: 'LaunchDaemon' }], run });
    expect(snapshot.errors).toEqual([`${root}/a-dangling.plist: a-dangling.plist: file does not exist`]);
    expect(referenceReason('/tree', snapshot)).toBe('LaunchDaemon dev.daemon (Program)');
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test.skipIf(asRoot)("an unreadable plist in the user's own LaunchAgents folder still refuses removal", () => {
  const t = mkdtempSync(join(tmpdir(), 'scheduler-unreadable-user-'));
  try {
    const root = `${t}/agents`; mkdirSync(root);
    writeFileSync(`${root}/a.plist`, 'x'); chmodSync(`${root}/a.plist`, 0o000);
    const run = cmd => cmd === 'plutil' ? { status: 1, stderr: 'permission denied' } : { status: 1, stderr: 'no crontab for user' };
    const snapshot = collectScheduled({ roots: [{ path: root, kind: 'LaunchAgent', user: true }], run });
    expect(snapshot.errors.length).toBe(1);
    expect(snapshot.errors[0]).toContain(`${root}/a.plist`);
  } finally { chmodSync(`${t}/agents/a.plist`, 0o600); rmSync(t, { recursive: true, force: true }); }
});

test('cron quotes, schedules, HOME forms and shell substitutions never execute', () => {
  const t = mkdtempSync(join(tmpdir(), 'cron-static-'));
  try {
    const text = `# /unrelated/job\nMAILTO=/unrelated\nHOME="${t}"\n0 1 * * * bash "./tree with spaces/job" >\${HOME}/logs/out\n@reboot bash ~/tree/job --input=$HOME/tree/in\n@hourly echo $(touch ${t}/sentinel) /tree/job\n`;
    const snapshot = collectScheduled({ home: t, roots: [], run: () => ({ status: 0, stdout: text }) });
    expect(referenceReason(`${t}/tree with spaces`, snapshot)).toContain('line 4');
    expect(referenceReason(`${t}/tree`, snapshot)).toContain('line 5');
    expect(referenceReason('/unrelated', snapshot)).toBeNull();
    expect(snapshot.errors).toEqual([]);
    // A command substitution was inspected as text, never passed to a shell.
    expect(existsSync(`${t}/sentinel`)).toBe(false);
  } finally { rmSync(t, { recursive: true, force: true }); }
});


test('macOS ps formatting retains long command lines and alias paths with spaces', () => {
  const t = mkdtempSync(join(tmpdir(), 'ps-alias-'));
  try {
    mkdirSync(`${t}/real`); symlinkSync(`${t}/real`, `${t}/space alias`);
    const text = `  123 /bin/bash ${t}/space alias/job.sh --arg=${'x'.repeat(20000)}\n`;
    const rows = processArgumentRows(text);
    expect(rows[0].argv[0].length).toBeGreaterThan(20000);
    expect(processHolders(`${t}/real`, rows, 999)).toEqual([{ pid: 123, argument: true }]);
    expect(processHolders(`${t}/real-sibling`, rows, 999)).toEqual([]);
  } finally { rmSync(t, { recursive: true, force: true }); }
});


test('real XML entity and binary fixtures use the same native-decoder argument contract', () => {
  const t = mkdtempSync(join(tmpdir(), 'plist-formats-'));
  const binary = Buffer.from('YnBsaXN0MDDSAQIDBFVMYWJlbFdQcm9ncmFtV2Rldi5qb2JZL3RyZWUvYSZiCA0TGyMAAAAAAAABAQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAALQ==', 'base64');
  try {
    const results = [];
    for (const [format, bytes] of [['xml', '<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>dev.job</string><key>Program</key><string>/tree/a&amp;b</string></dict></plist>'], ['binary', binary]]) {
      const root = `${t}/${format}`; mkdirSync(root); writeFileSync(`${root}/job.plist`, bytes);
      const snapshot = collectScheduled({ roots: [{ path: root, kind: 'LaunchAgent' }], run: (cmd, args) => {
        if (cmd === 'crontab') return { status: 1, stderr: 'no crontab for user' };
        expect(args).toEqual(['-convert', 'json', '-o', '-', `${root}/job.plist`]);
        const input = readFileSync(args.at(-1));
        expect(input.equals(Buffer.from(bytes))).toBe(true);
        // Fake native plutil output. Native macOS conversion is a host follow-up.
        return { status: 0, stdout: '{"Label":"dev.job","Program":"/tree/a&b"}' };
      } });
      results.push(snapshot.references);
      expect(referenceReason('/tree/a&b', snapshot)).toBe('LaunchAgent dev.job (Program)');
    }
    expect(results[0]).toEqual(results[1]);
  } finally { rmSync(t, { recursive: true, force: true }); }
});


test('symlink parent components resolve before dot-dot, including absent suffixes', () => {
  const t = mkdtempSync(join(tmpdir(), 'parent-symlink-'));
  try {
    mkdirSync(`${t}/tree/subdir`, { recursive: true });
    symlinkSync(`${t}/tree/subdir`, `${t}/alias`);
    writeFileSync(`${t}/tree/job`, '');
    expect(canonicalPath(`${t}/alias/../job`)).toBe(`${t}/tree/job`);
    expect(canonicalPath(`${t}/alias/../missing/log`)).toBe(`${t}/tree/missing/log`);
    expect(processHolders(`${t}/tree`, [{ pid: 123, argv: [`${t}/alias/../job`] }], 999)).toEqual([{ pid: 123, argument: true }]);
    expect(referenceReason(`${t}/tree`, { references: [{ path: `${t}/alias/../missing/log`, reason: 'job' }] })).toBe('job');
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('combined shell flags containing c preserve scheduler and process references', () => {
  for (const flags of ['-ec', '-ce', '-euc', '-lc']) {
    expect(processHolders('/tree', [{ pid: 123, argv: ['bash', flags, 'exec /tree/job'], cwd: '/outside' }], 999)).toEqual([{ pid: 123, argument: true }]);
  }
  const t = mkdtempSync(join(tmpdir(), 'shell-plist-'));
  try {
    writeFileSync(`${t}/job.plist`, '<plist/>');
    const snapshot = collectScheduled({ roots: [{ path: t, kind: 'LaunchAgent' }], run: cmd => cmd === 'plutil' ? { status: 0, stdout: '{"Label":"dev.shell","ProgramArguments":["bash","-ec","exec /tree/job"]}' } : { status: 1, stderr: 'no crontab for user' } });
    expect(referenceReason('/tree', snapshot)).toBe('LaunchAgent dev.shell (ProgramArguments)');
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('a quoted shell command nested inside another shell command keeps its path operands', () => {
  const t = mkdtempSync(join(tmpdir(), 'nested-shell-'));
  try {
    writeFileSync(`${t}/job.plist`, '<plist/>');
    const cron = `@hourly bash -lc 'exec /tree/job.sh'\n@daily sh -c "bash -c 'exec /deep/job.sh'"\n@daily rsync -avc "/spaced tree/x/" /backup\n`;
    const snapshot = collectScheduled({ home: t, user: 'ryan', roots: [{ path: t, kind: 'LaunchAgent' }], run: cmd => cmd === 'plutil'
      ? { status: 0, stdout: JSON.stringify({ Label: 'dev.nested', ProgramArguments: ['/bin/sh', '-c', "bash -lc 'exec /agent/job.sh'"] }) }
      : { status: 0, stdout: cron } });
    expect(snapshot.errors).toEqual([]);
    expect(referenceReason('/tree', snapshot)).toBe("crontab ryan line 1: @hourly bash -lc 'exec /tree/job.sh'");
    expect(referenceReason('/deep', snapshot)).toContain('line 2');
    // A quoted spaced operand after a flag containing c stays whole as well as being re-read.
    expect(referenceReason('/spaced tree/x', snapshot)).toContain('line 3');
    expect(argumentPaths(['sh', '-c', `sh -c 'rsync -avc "/spaced tree/x/" /b'`], {})).toContain('/spaced tree/x');
    expect(referenceReason('/agent', snapshot)).toBe('LaunchAgent dev.nested (ProgramArguments)');
    expect(referenceReason('/tree-sibling', snapshot)).toBeNull();
    expect(processHolders('/tree', [{ pid: 123, argv: ['sh', '-c', "bash -lc 'exec /tree/job.sh'"], cwd: '/outside' }], 999)).toEqual([{ pid: 123, argument: true }]);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('resolveLinks matches realpath for links, chains, loops and missing paths, without opening anything', () => {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'resolve-links-')));
  try {
    mkdirSync(`${t}/real/sub/deep`, { recursive: true });
    writeFileSync(`${t}/real/sub/f`, '');
    symlinkSync('real', `${t}/alias`);
    symlinkSync('../real/sub', `${t}/real/up`);
    symlinkSync(`${t}/real/sub/deep`, `${t}/abs`);
    symlinkSync('alias/sub', `${t}/chain`);
    symlinkSync('f', `${t}/real/sub/flink`);
    symlinkSync('loop2', `${t}/loop1`); symlinkSync('loop1', `${t}/loop2`);
    for (const c of ['alias', 'alias/sub/deep', 'real/up/deep', 'abs', 'chain/deep', 'real/sub/flink', '.'])
      expect(resolveLinks(`${t}/${c}`)).toBe(realpathSync(`${t}/${c}`));
    expect(() => resolveLinks(`${t}/missing/x`)).toThrow(expect.objectContaining({ code: 'ENOENT' }));
    expect(() => resolveLinks(`${t}/real/sub/f/x`)).toThrow(expect.objectContaining({ code: 'ENOTDIR' }));
    expect(() => resolveLinks(`${t}/loop1`)).toThrow(expect.objectContaining({ code: 'ELOOP' }));
    // `..` after a link is physical, as POSIX realpath(3) does.
    expect(resolveLinks(`${t}/chain/../sub`)).toBe(`${t}/real/sub`);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('a named pipe and a socket resolve as paths and are never opened', () => {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'resolve-special-')));
  try {
    mkfifo(`${t}/fifo`); mksock(`${t}/sock`); symlinkSync('fifo', `${t}/fifo-alias`);
    // An open of the pipe would block this test until its timeout.
    expect(canonicalPath(`${t}/fifo-alias`)).toBe(`${t}/fifo`);
    expect(canonicalPath(`${t}/sock`)).toBe(`${t}/sock`);
    expect(processHolders(t, [{ pid: 7, argv: ['cat', `${t}/fifo-alias`], cwd: '/outside' }], 999)).toEqual([{ pid: 7, argument: true }]);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('no realpathSync is left in the prune script or its reference library', () => {
  for (const f of ['prune-worktrees.mjs', 'lib/worktree-references.mjs'])
    expect(readFileSync(new URL(`../skills/prune-worktrees/scripts/${f}`, import.meta.url), 'utf8')).not.toMatch(/\brealpathSync\b/);
});

test('macOS-style matching folds case and only ever adds a match', () => {
  const snapshot = { references: [{ path: '/volumes/farm/wt/repo/a/job', reason: 'job' }] };
  expect(referenceReason('/Volumes/Farm/WT/repo/a', snapshot, { foldCase: true })).toBe('job');
  expect(referenceReason('/Volumes/Farm/WT/repo/a', snapshot, { foldCase: false })).toBeNull();
  expect(referenceReason('/Volumes/Farm/WT/repo/ab', snapshot, { foldCase: true })).toBeNull(); // boundary still holds
  expect(processHolders('/Volumes/Farm/WT/a', [{ pid: 7, cwd: '/volumes/farm/wt/a/src' }], 999, { foldCase: true })).toEqual([{ pid: 7, argument: false }]);
  expect(processHolders('/Volumes/Farm/WT/a', [{ pid: 7, cwd: '/volumes/farm/wt/a/src' }], 999, { foldCase: false })).toEqual([]);
  expect(processHolders('/Volumes/Farm/WT/a', [{ pid: 8, argv: ['/volumes/farm/wt/a/run x'], flattened: true }], 999, { foldCase: true })).toEqual([{ pid: 8, argument: true }]);
});

test('special plists never reach plutil', () => {
  const t = mkdtempSync(join(tmpdir(), 'special-plist-'));
  try {
    const root = `${t}/daemons`; mkdirSync(root);
    mkfifo(`${root}/a.plist`); writeFileSync(`${root}/b.plist`, '<plist/>');
    const seen = [];
    const run = (cmd, args) => { if (cmd === 'plutil') { seen.push(args.at(-1)); return { status: 0, stdout: '{"Label":"b"}' }; } return { status: 1, stderr: 'no crontab for u' }; };
    const system = collectScheduled({ home: t, user: 'u', roots: [{ path: root, kind: 'LaunchDaemon' }], run });
    expect(seen).toEqual([`${root}/b.plist`]);
    expect(system.diagnostics).toEqual([`${root}/a.plist: a named pipe, not a regular file; skipped, never opened`]);
    expect(system.errors).toEqual([]);
    seen.length = 0;
    const user = collectScheduled({ home: t, user: 'u', roots: [{ path: root, kind: 'LaunchAgent', user: true }], run });
    expect(seen).toEqual([`${root}/b.plist`]);
    expect(user.errors).toEqual([`${root}/a.plist: a named pipe, not a regular file; never opened`]);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

// ─── CTC-11314: a huge command line is read in linear time, and no tree it names is released ───────
// Performance cases run in a child process under a timeout and an address-space cap, on synthetic
// records only. No test here reads the live process table.
const HARNESS = fileURLToPath(new URL('./lib/huge-process-record.mjs', import.meta.url));
function harness(...args) {
  const r = Bun.spawnSync(['sh', '-c', 'ulimit -v 4194304 2>/dev/null; exec "$@"', 'sh', 'bun', HARNESS, ...args], { timeout: 30_000, stdout: 'pipe', stderr: 'pipe' });
  return {
    timedOut: r.exitedDueToTimeout === true, exitCode: r.exitCode, maxRSS: r.resourceUsage?.maxRSS,
    lines: r.stdout.toString().split('\n').filter(Boolean).map(l => JSON.parse(l)), stderr: r.stderr.toString(),
  };
}

test('a 1 MB process record of 20,000 temp paths classifies in under 10 s and under 256 MB', () => {
  for (const shape of ['flattened', 'argv', 'shell']) {
    const r = harness('big', shape);
    expect({ shape, timedOut: r.timedOut, exitCode: r.exitCode, stderr: r.stderr.slice(-300) }).toEqual({ shape, timedOut: false, exitCode: 0, stderr: r.stderr.slice(-300) });
    expect(typeof r.maxRSS).toBe('number');
    expect(r.maxRSS).toBeLessThan(256_000_000);
    const [line] = r.lines;
    console.log(`CTC-11314 big ${shape}: ${line.ms} ms, maxRSS ${r.maxRSS}`);
    expect(line.bytes).toBeGreaterThanOrEqual(1_048_576);
    expect(line.ms).toBeLessThan(10_000);
    expect(line.held).toEqual([]);
  }
}, 120_000);

test('a record just under 64 KB and one huge argument classify in under 2 s', () => {
  const under = harness('under');
  expect({ timedOut: under.timedOut, exitCode: under.exitCode }).toEqual({ timedOut: false, exitCode: 0 });
  expect(under.lines[0].bytes).toBeLessThan(65_536);
  expect(under.lines[0].ms).toBeLessThan(2000);
  expect(under.lines[0].held).toEqual([]);
  for (const shape of ['argv', 'flattened']) {
    const r = harness('blob', shape);
    expect({ shape, timedOut: r.timedOut, exitCode: r.exitCode }).toEqual({ shape, timedOut: false, exitCode: 0 });
    expect(r.lines[0].ms).toBeLessThan(2000);
    expect(r.lines[0].held).toEqual([]);
  }
}, 120_000);

test('canonicalPath reads whole components within the first 4096 characters', () => {
  const r = harness('path');
  expect({ timedOut: r.timedOut, exitCode: r.exitCode }).toEqual({ timedOut: false, exitCode: 0 });
  expect(r.lines[0].ms).toBeLessThan(2000);
  expect(r.lines[0].length).toBeLessThanOrEqual(PATH_LIMIT);
  expect(r.lines[0].prefixOk).toBe(true);
}, 60_000);

test('an oversized record keeps a tree it names after its first 64 KB', () => {
  const r = harness('in-use');
  expect({ timedOut: r.timedOut, exitCode: r.exitCode }).toEqual({ timedOut: false, exitCode: 0 });
  const held = Object.fromEntries(r.lines.map(l => [l.form, l.held]));
  for (const line of r.lines) expect(line.bytes).toBeGreaterThan(RECORD_LIMIT);
  for (const form of ['flattened-file', 'flattened-bare', 'argv-file', 'shell-cd', 'flattened-colon', 'argv-colon']) expect(held[form]).toEqual(['wt-in-use']);
  // A sibling named only by its own path never holds the tree whose name it extends.
  for (const form of ['flattened-sibling', 'argv-sibling']) expect(held[form]).toEqual(['wt-in-use-sibling']);
  for (const form of ['flattened-spaced', 'flattened-alias-spaced']) expect(held[form]).toEqual(['prune test/wt with space']);
}, 60_000);

test('a worktree path with spaces is held in every shape a process names it', () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), 'prune test root-')));
  try {
    const tree = `${T}/prune test/wt with space`;
    mkdirSync(tree, { recursive: true });
    symlinkSync(`${T}/prune test`, `${T}/space alias`);
    const rows = (text) => processArgumentRows(text);
    const held = (records) => processHolders(tree, records, 1).length > 0;
    expect(held(rows(`  9 bash ${tree}/run.sh\n`))).toBe(true);
    expect(held(rows(`  9 tail -f ${tree}\n`))).toBe(true);
    expect(held([{ pid: 9, argv: [`${tree}/run.sh`], cwd: '/outside' }])).toBe(true);
    expect(held([{ pid: 9, argv: ['sh', '-c', `cd "${tree}" && make`], cwd: '/outside' }])).toBe(true);
    expect(held([{ pid: 9, argv: ['sh', '-c', `cd ${tree.replace(/ /g, '\\ ')} && make`], cwd: '/outside' }])).toBe(true);
    expect(held(rows(`  9 bash ${T}/space alias/wt with space/run.sh\n`))).toBe(true);
    expect(held(rows(`  9 bash ${'/tmp/nothing-here '.repeat(4000)}${tree}/run.sh\n`))).toBe(true);
    expect(held(rows('  9 sleep 1\n'))).toBe(false);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

// A seeded generator of command lines over a fixture of real, linked, missing and spaced paths.
function differentialFixture() {
  const T = realpathSync(mkdtempSync(join(tmpdir(), 'differential-')));
  for (const dir of ['real/sub', 'dir /wt', 'a b c/wt-a', 'wt-a', 'wt-ab', 'prune test/wt with space']) mkdirSync(`${T}/${dir}`, { recursive: true });
  writeFileSync(`${T}/real/f`, '');
  symlinkSync(`${T}/real`, `${T}/space alias`); symlinkSync(`${T}/real`, `${T}/alias`);
  symlinkSync('../wt-a', `${T}/real/up`); symlinkSync('nowhere', `${T}/dangling`);
  const trees = ['real', 'real/sub', 'dir ', 'dir /wt', 'a b c', 'a b c/wt-a', 'wt-a', 'wt-ab', 'prune test', 'prune test/wt with space'].map(n => `${T}/${n}`);
  return { T, trees: [...trees, T] };
}
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function generateLines(T) {
  const rand = seeded(20261128);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const bases = [T, T, T, T, '~', '$HOME', '/tmp', '/nonexistent'];
  const comps = ['real', 'sub', 'f', 'space alias', 'alias', 'up', 'dangling', 'dir ', 'wt', 'a b c', 'wt-a', 'wt-ab', 'prune test', 'wt with space', 'missing', '.', 'x y', 'job.sh'];
  const path = () => {
    let out = pick(bases), named = 0, dots = 0;
    for (let n = 1 + Math.floor(rand() * 4); n > 0; n--) {
      const c = pick(comps); out += `/${c}`; if (c !== '.') named++;
      if (named > dots && rand() < 0.2) { out += '/..'; dots++; named--; }
    }
    return out;
  };
  const token = () => {
    const r = rand();
    if (r < 0.45) return path();
    if (r < 0.55) return `--out=${path()}`;
    if (r < 0.65) return `"${path()}"`;
    if (r < 0.72) return `'${path()}'`;
    return pick(['-c', '-lc', '--flag', 'VAR=1', 'rm', 'cat', ';', '|', '>', '&&', 'make']);
  };
  const lines = [
    `bash ${T}/space alias/job.sh --flag`, `cp ${T}/space alias ${T}/x`, `rm -rf ${T}/wt-a-sibling/x ${T}/other`, `tool --out=${T}/wt-a/log`,
    `sh -c 'cd "${T}/prune test/wt with space" && make'`, `cat ${T}/dir /wt/log`, `exec ${T}/real/up/x`, `cat ${T}/alias/../wt-ab/x`,
    `bash ${T}/space alias/job.sh --arg=${'x'.repeat(20000)}`,
  ];
  for (let i = 0; i < 600; i++) lines.push(Array.from({ length: 1 + Math.floor(rand() * 6) }, token).join(' '));
  for (let i = 0; i < 10; i++) {
    const parts = [];
    for (let n = 10 + Math.floor(rand() * 21), size = 0; n > 0 || size < 20000; n--) {
      const filler = 'f'.repeat(200 + Math.floor(rand() * 2500)) + (rand() < 0.33 ? '/' : '');
      const word = rand() < 0.5 ? token() : filler;
      parts.push(word); size += word.length + 1;
    }
    lines.push(parts.join(' '));
  }
  return lines;
}

test('normal command lines give the same holder decisions as the reader before this change', () => {
  const { T, trees } = differentialFixture();
  try {
    const shapes = {
      flattened: (reader, line, i) => reader.processArgumentRows(`  4242 ${line}\n`),
      argv: (reader, line, i) => [{ pid: 4242, argv: line.split(' '), ...(i % 2 ? { cwd: T } : {}) }],
      shell: (reader, line, i) => [{ pid: 4242, argv: ['sh', '-c', line], ...(i % 2 ? { cwd: T } : {}) }],
    };
    for (const [i, line] of generateLines(T).entries()) {
      for (const [shape, build] of Object.entries(shapes)) {
        for (const foldCase of [false, true]) {
          const now = build({ processArgumentRows }, line, i); const old = build(before, line, i);
          for (const tree of trees) {
            const a = processHolders(tree, now, 1, { foldCase }).length > 0;
            const b = before.processHolders(tree, old, 1, { foldCase }).length > 0;
            if (a !== b) throw new Error(`decision differs (reader now ${a}, before ${b}) for line ${i} shape ${shape} foldCase ${foldCase} tree ${tree}: ${line.slice(0, 300)}`);
          }
        }
      }
    }
  } finally { rmSync(T, { recursive: true, force: true }); }
}, 60_000);

test("a later path's dot-dot no longer climbs into the path before it", () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), 'dotdot-')));
  try {
    mkdirSync(`${T}/wt-a`); mkdirSync(`${T}/dir /wt`, { recursive: true });
    const row = (text) => [processArgumentRows(`  7 ${text}\n`), before.processArgumentRows(`  7 ${text}\n`)];
    const [now, old] = row(`rm ${T}/missing /../wt-a`);
    expect(before.processHolders(`${T}/wt-a`, old, 1)).toHaveLength(1);
    expect(processHolders(`${T}/wt-a`, now, 1)).toHaveLength(0);
    for (const text of [`rm ${T}/missing ${T}/x/../wt-a`]) {
      const [n, o] = row(text);
      expect(processHolders(`${T}/wt-a`, n, 1)).toHaveLength(1); expect(before.processHolders(`${T}/wt-a`, o, 1)).toHaveLength(1);
    }
    const [n, o] = row(`cat ${T}/dir /wt/log`);
    expect(processHolders(`${T}/dir /wt`, n, 1)).toHaveLength(1); expect(before.processHolders(`${T}/dir /wt`, o, 1)).toHaveLength(1);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('an unparseable ps line keeps every tree its raw text names', () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), 'unparseable-')));
  try {
    const trees = ['a', 'b', 'c', 'd', 'e', 'f'].map(n => { mkdirSync(`${T}/wt-${n}`); return `${T}/wt-${n}`; });
    const rows = processArgumentRows(`  17 sh -c "echo\nsecond line ${T}/wt-a/job\n  18 ok\n  12 cat ${T}/wt-b/x\r\nlist ${T}/wt-d,x (${T}/wt-e) ${T}/wt-f-sibling/y\n\n   \n`);
    expect(rows.map(r => r.pid)).toEqual([17, null, 18, null, null]);
    expect(rows[0]).toEqual({ pid: 17, argv: ['sh -c "echo'], flattened: true });
    expect(rows.slice(1).filter(r => r.unparseable).map(r => [r.line, r.afterPid])).toEqual([[2, 17], [4, 18], [5, 18]]);
    const [a, b, c, d, e, f] = trees;
    expect(processHolders(a, rows, 1)).toEqual([{ pid: null, argument: false, unparseable: true, source: 'ps', line: 2 }]);
    for (const tree of [b, d, e, f]) expect(processHolders(tree, rows, 1)).toHaveLength(1);
    expect(processHolders(c, rows, 1)).toEqual([]);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('recordNotes counts oversized records and lists unparseable ones by position', () => {
  const big = { pid: 5, argv: ['x'.repeat(70_000)] };
  const notes = recordNotes([big, { pid: 6, argv: ['sleep', '1'] }, ...processArgumentRows('secret one\n  3 ok\nsecret two\n')]);
  expect(notes).toEqual({
    oversized: 1, oversizedRecords: [{ pid: 5, bytes: 70_000 }], unparsed: 2,
    unparsedRecords: [{ source: 'ps', line: 1, bytes: 10, afterPid: null }, { source: 'ps', line: 3, bytes: 10, afterPid: 3 }],
  });
  expect(JSON.stringify(notes)).not.toContain('secret');
  const many = recordNotes(processArgumentRows('junk\n'.repeat(25)));
  expect(many.unparsed).toBe(25);
  expect(many.unparsedRecords).toHaveLength(20);
});
