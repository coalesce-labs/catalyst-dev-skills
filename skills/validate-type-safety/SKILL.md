---
name: validate-type-safety
description: "Run the 5-step TypeScript validation gate: type check, reward hacking scan, test inclusion, tests and lint. Detects the package manager and linter, checks tsconfig strictness, and runs the scan-reward-hacking skill as one step. Use when the user asks to validate types, check type safety or run the type safety gate; before a PR on TypeScript changes; after a plan phase completes; or whenever type checks, tests and lint should run together. Use it even when running tsc directly seems enough: it catches test exclusions, loose tsconfig and reward hacking that tsc passes."
disable-model-invocation: false
allowed-tools: Bash, Read, Grep, Glob
version: 1.1.0
---

# Validate Type Safety

The final gate before TypeScript work is marked complete. All five steps must pass.

**In a validate stage** (`CATALYST_PHASE` or `CATALYST_STAGE` is `validate`), read [references/validate-stage.md](references/validate-stage.md) before Step 1. Its rules replace the fix-and-rerun rules here: you record findings and fix nothing. Everywhere else, including when the `implement-plan` skill runs this as its gate, the rules below apply.

## Detect the tooling

Detect each command from the project; use no hardcoded `bun`, `npm` or `trunk`.

- **Package manager**, by lockfile in the project root, first match wins: `bun.lockb` or `bun.lock` → `bun run`; `pnpm-lock.yaml` → `pnpm run`; `yarn.lock` → `yarn run`; `package-lock.json` → `npm run`. Call it `$PM_RUN`.
- **Linter**, first match wins: a `.trunk/` directory → `trunk check --ci --upstream origin/main`; `biome.json` or `biome.jsonc` → `${PM_RUN} biome check .`; `eslint.config.*` or `.eslintrc.*` → `${PM_RUN} eslint .`. With none, Step 5 is SKIPPED.
- **Type check**: the `type-check` or `typecheck` script in `package.json` (in a monorepo, the root workspace-level script first), run as `${PM_RUN} type-check`. With no script, `npx tsc --noEmit`.

## Steps

Stop at the first failing step, report it and what needs fixing, then re-run all steps after the fix.

0. **tsconfig strictness (informational, never fails).** Read the tsconfig that covers the changed files; in a monorepo, Glob for `tsconfig.json` files and pick the one whose `include`, `exclude` and `references` cover them. WARN if `"strict": true` is missing. INFO for each missing recommended option: `noUncheckedIndexedAccess`, `noImplicitReturns`, `exactOptionalPropertyTypes`.
1. **Type check.** Run the detected command. Pass: exit code 0, zero errors. Fix every error before Step 2.
2. **Reward hacking scan.** Run the `scan-reward-hacking` skill on the changed files, with `--base <ref>` set to the review base when there is one, so only lines the change added count. Pass: its PASS verdict, with no unfixed CRITICAL or HIGH pattern.
3. **Test inclusion.** Grep the tsconfig files (of the changed packages, in a monorepo) for `\.test\.ts`, `\.spec\.ts` or a test directory inside an `exclude` array. Pass: no tsconfig excludes tests from type checking.
4. **Tests.** Run `${PM_RUN} test`. In a monorepo with a `--filter` or `--scope` option, run only the affected packages. Pass: every test passes.
5. **Lint.** Run the detected linter. Pass: zero lint errors, or SKIPPED when no linter was detected.

If `type-coverage` is available (`which type-coverage` or `npx type-coverage --help`), also report `npx type-coverage --at-least 0`. It never affects the verdict.

## Verdict

**PASS** requires all of: the type check exits 0; no CRITICAL or HIGH reward hacking pattern; no tsconfig in the changed packages excludes tests; every test passes; lint passes or no linter was detected.

**FAIL** when any step fails because of this branch. Report in the format in [references/output-format.md](references/output-format.md), listing every item that must be fixed.

On FAIL, the work is not complete: fix every issue, re-run the validation, and mark the work complete only when it passes.
