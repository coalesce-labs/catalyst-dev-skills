import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, realpathSync, symlinkSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const snapshot = { references: [{ path: '/users/me/wt/repo/a/job', reason: 'job' }] };
  expect(referenceReason('/Users/me/WT/repo/a', snapshot, { foldCase: true })).toBe('job');
  expect(referenceReason('/Users/me/WT/repo/a', snapshot, { foldCase: false })).toBeNull();
  expect(referenceReason('/Users/me/WT/repo/ab', snapshot, { foldCase: true })).toBeNull(); // boundary still holds
  expect(processHolders('/Users/me/WT/a', [{ pid: 7, cwd: '/users/me/wt/a/src' }], 999, { foldCase: true })).toEqual([{ pid: 7, argument: false }]);
  expect(processHolders('/Users/me/WT/a', [{ pid: 7, cwd: '/users/me/wt/a/src' }], 999, { foldCase: false })).toEqual([]);
  expect(processHolders('/Users/me/WT/a', [{ pid: 8, argv: ['/users/me/wt/a/run x'], flattened: true }], 999, { foldCase: true })).toEqual([{ pid: 8, argument: true }]);
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
