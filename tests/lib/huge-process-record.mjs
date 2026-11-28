// CTC-11314 harness: classifies synthetic process records of huge size against the worktree-reference
// reader. It never reads the live process table. Tests run it as a child process under a timeout and an
// address-space cap, so a regression fails the test instead of hanging or exhausting the host.
//   huge-process-record.mjs big <flattened|argv|shell> | under | blob <argv|flattened> | path | in-use
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { canonicalPath, processArgumentRows, processHolders } from '../../skills/prune-worktrees/scripts/lib/worktree-references.mjs';

const [mode, shape] = process.argv.slice(2);
const T = realpathSync(mkdtempSync(join(tmpdir(), 'huge-record-')));
const print = (value) => console.log(JSON.stringify(value));
const bytesOf = (argv) => argv.reduce((n, a) => n + Buffer.byteLength(a), Math.max(0, argv.length - 1));
const treeNames = ['wt-a', 'wt-b', 'wt-c'];
const mkTrees = (names) => { for (const name of names) mkdirSync(`${T}/${name}`, { recursive: true }); return names.map(n => `${T}/${n}`); };

// Temp paths, 53 characters or more; even-numbered ones exist as empty files and odd ones are absent.
function tempPaths(count, create = true) {
  mkdirSync(`${T}/tmp`, { recursive: true });
  const paths = [];
  for (let i = 0; i < count; i++) {
    const base = `${T}/tmp/rm-tmp-${String(i).padStart(8, '0')}-`;
    const path = base + 'x'.repeat(Math.max(1, 53 - base.length));
    if (create && i % 2 === 0) writeFileSync(path, '');
    paths.push(path);
  }
  return paths;
}
const record = (kind, line) => {
  if (kind === 'flattened') return processArgumentRows(`  4242 ${line}\n`)[0];
  const words = line.split(' ');
  return kind === 'argv' ? { pid: 4242, argv: words, cwd: '/outside' } : { pid: 4242, argv: ['sh', '-c', line], cwd: '/outside' };
};
const heldBy = (trees, records) => trees.filter(tree => processHolders(tree, records, 1).length).map(tree => tree.slice(T.length + 1));

try {
  if (mode === 'big') {
    const started = performance.now();
    const trees = mkTrees(treeNames);
    const line = `rm -rf ${tempPaths(20000).join(' ')}`;
    const rec = record(shape, line);
    const held = heldBy(trees, [rec]);
    print({ shape, bytes: bytesOf(rec.argv), ms: Math.round(performance.now() - started), held });
  } else if (mode === 'under') {
    const trees = mkTrees(treeNames);
    const started = performance.now();
    const paths = tempPaths(2000, false); let count = 0, size = 'rm -rf'.length;
    while (count < paths.length && size + 1 + paths[count].length < 65536) size += 1 + paths[count++].length;
    const rec = record('flattened', `rm -rf ${paths.slice(0, count).join(' ')}`);
    const held = heldBy(trees, [rec]);
    print({ bytes: bytesOf(rec.argv), ms: Math.round(performance.now() - started), held, paths: count });
  } else if (mode === 'blob') {
    const [tree] = mkTrees(['wt-a']);
    const blob = ('x'.repeat(63) + '/').repeat(1_000_000 / 64);
    const started = performance.now();
    const rec = shape === 'argv' ? { pid: 4242, argv: ['tool', `--data=${blob}`], cwd: T } : processArgumentRows(`  4242 tool --data=${blob}\n`)[0];
    const held = heldBy([tree], [rec]);
    print({ shape, bytes: bytesOf(rec.argv), ms: Math.round(performance.now() - started), held });
  } else if (mode === 'path') {
    const started = performance.now();
    const result = canonicalPath(`${T}/missing` + '/x'.repeat(100000));
    print({ ms: Math.round(performance.now() - started), length: result.length, prefixOk: result.startsWith(`${T}/missing/x/`) });
  } else if (mode === 'in-use') {
    mkdirSync(`${T}/prune test`, { recursive: true });
    const trees = [...mkTrees(['wt-in-use', 'wt-in-use-sibling']), `${T}/prune test/wt with space`];
    mkdirSync(trees[2]);
    symlinkSync(`${T}/prune test`, `${T}/space alias`);
    const filler = tempPaths(1400, false).join(' ');
    const [tree] = trees; const spaced = trees[2];
    const cases = [
      ['flattened-file', 'flattened', `rm ${filler} ${tree}/out.log`],
      ['flattened-bare', 'flattened', `rm ${filler} ${tree}`],
      ['argv-file', 'argv', `rm ${filler} ${tree}/out.log`],
      ['shell-cd', 'shell', `rm ${filler} && cd "${tree}" && make`],
      ['flattened-colon', 'flattened', `tool ${filler} --paths=/a:${tree}:/b`],
      ['argv-colon', 'argv', `tool ${filler} --paths=/a:${tree}:/b`],
      ['flattened-sibling', 'flattened', `rm ${filler} ${tree}-sibling/x`],
      ['argv-sibling', 'argv', `rm ${filler} ${tree}-sibling/x`],
      ['flattened-spaced', 'flattened', `bash ${filler} ${spaced}/run.sh`],
      ['flattened-alias-spaced', 'flattened', `bash ${filler} ${T}/space alias/wt with space/run.sh`],
    ];
    for (const [form, kind, line] of cases) {
      const rec = record(kind, line);
      print({ form, bytes: bytesOf(rec.argv), held: heldBy(trees, [rec]) });
    }
  } else { console.error(`unknown mode ${mode}`); process.exitCode = 2; }
} finally { rmSync(T, { recursive: true, force: true }); }
