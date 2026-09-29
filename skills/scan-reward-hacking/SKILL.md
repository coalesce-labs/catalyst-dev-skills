---
name: scan-reward-hacking
description: "Scan TypeScript code for reward hacking: shortcuts that make the type checker, linter or tests pass without fixing type safety. Carries a 12-pattern checklist with severity tuned for libraries and apps. Use when the user asks to scan for hacks, type cheats or shortcuts; wants to check for `as any`, `as unknown as`, `@ts-ignore`, `@ts-nocheck`, non-null assertions (`value!`), `forEach(async`, void tricks, `eslint-disable`, `biome-ignore`, `.skip`/`.only` tests, or a loosened or excluding tsconfig; after the fix-typescript skill completes; or before marking TypeScript work done. Accepts optional file/directory arguments and `--base <ref>`."
disable-model-invocation: false
allowed-tools: Bash, Read, Grep, Glob
argument-hint: "[--base <ref>] [files-or-directories]"
version: 1.2.0
---

# Scan for Reward Hacking Patterns

Reward hacking is code that makes a check pass without fixing the type safety the check guards. Run this scan before TypeScript work is marked complete.

## Scope

**Paths.** Scan the paths in `$ARGUMENTS`. With none, Glob for `src/`, `apps/`, `packages/` and `lib/`, and scan each one that exists.

**Diff scope.** When the scan checks a change (after a fix, in a remediate round, or with `--base <ref>`), report only what the change added. The base is `<ref>` when given, otherwise `HEAD` (the uncommitted change).

1. The added lines are the `+` lines of `git diff -U0 <base> -- <paths>`. Every line of a file `git ls-files --others --exclude-standard` lists is added.
2. A match on an added line counts toward the verdict.
3. A match on a line the change did not add predates it. List it under ACCEPTABLE as pre-existing and do not FAIL on it.
4. Patterns 11 and 12 read `git diff <base> -- '*tsconfig*.json'` rather than grep matches.

**Severity.** A file under `packages/` takes the library severity, because other code consumes its exported types. Every other file takes the app severity.

## The 12 patterns

Search with the Grep tool over `*.{ts,tsx}` and report every match. Pattern 9 also searches `*.{js,jsx,mjs,cjs}`. Where acceptance depends on a guard or a comment, read the match with `-B 3` context.

| # | Pattern | Grep | Library / app | Acceptable when |
|---|---|---|---|---|
| 1 | Undocumented double-cast | `as unknown as` | HIGH / HIGH | a comment above names the library limitation, what was verified at runtime, and a tracking ticket |
| 2 | Direct any cast | `as any` | CRITICAL / HIGH | it builds a mock in a test file |
| 3 | Void trick | `void (0`, `void _` | CRITICAL / CRITICAL | never |
| 4 | Underscore-prefixed local | `const _[a-zA-Z]`, `let _[a-zA-Z]` | MEDIUM / MEDIUM | it is a function parameter; a local variable never is |
| 5 | Directive comment | `@ts-ignore`, `@ts-expect-error` | CRITICAL / HIGH | it states the reason and a tracking ticket |
| 6 | Non-null assertion | `\w+!\.`, `\w+!\[`, `\w+!;` | HIGH / MEDIUM | a runtime guard precedes it: `!= null`, `!== null`, `!== undefined`, `!= undefined`, a truthiness check, an `if`, or `map.has(key)` before `map.get(key)!` |
| 7 | Async correctness | `\.forEach\(async` | HIGH / HIGH | never: it drops the promises. Use `for...of` or `Promise.all(array.map(...))` |
| 8 | Exported unused type | `^export type [A-Z]`, `^export interface [A-Z]` | LOW, informational | always; it never affects the verdict |
| 9 | Whole-file or lint suppression | `@ts-nocheck`, `eslint-disable` (covers `-next-line` and `-line`), `biome-ignore` | CRITICAL / HIGH | it predates the change |
| 10 | Skipped or focused test | see below | HIGH / HIGH | it predates the change |
| 11 | Loosened tsconfig | see below | CRITICAL / HIGH | it predates the change |
| 12 | tsconfig exclusion | see below | CRITICAL / HIGH | it predates the change |

- **Pattern 7** also covers an async call with no `await`, `return`, `void` or `.then()`. Grep cannot find that reliably: note any you spot as informational.
- **Pattern 10** greps `\b(it|test|describe)\.(skip|only)\(` and `\b(xit|xdescribe|fit|fdescribe)\(`. A focused test (`.only`) skips every other test in the file.
- **Pattern 11** is a `tsconfig*.json` diff that removes, or sets to `false`, any of `strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns` or `noImplicitOverride`, or adds `"skipLibCheck": true`.
- **Pattern 12** is a `tsconfig*.json` diff that adds an `exclude` entry, or narrows `include` so a file it covered is no longer type-checked.
- **Patterns 9 to 12** are never acceptable on a line the change added. The fix is to fix the type error, the lint finding or the failing test.

For worked acceptable and unacceptable examples of each pattern, read [references/judging-matches.md](references/judging-matches.md).

## Report and verdict

Write the results in the format in [references/output-format.md](references/output-format.md): scope, diff base, severity mode, then matches grouped CRITICAL, HIGH, MEDIUM and ACCEPTABLE, then counts.

- **PASS:** no match needs a fix. Every match is absent, informational, pre-existing, or acceptable by its row.
- **FAIL:** any match needs a fix. List each one under Required Fixes with its `file:line`, the current code and the fix, in the reference's format. The work is complete only when every listed fix is made.
