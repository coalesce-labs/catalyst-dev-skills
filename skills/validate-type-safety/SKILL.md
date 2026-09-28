---
name: validate-type-safety
description: "Run the full 5-step TypeScript validation gate: type check, reward hacking scan, test inclusion, tests, and lint. This skill provides a structured multi-step pipeline that you cannot replicate on your own — it detects the project's package manager and linter automatically, checks tsconfig strictness, and invokes /scan-reward-hacking internally. **ALWAYS consult this skill when** the user mentions 'validate types', 'check type safety', 'type validation', 'type safety gate', wants to verify TypeScript changes before a PR, after completing a plan phase, or says anything about running type checks + tests + lint together. Even if you think you can run tsc yourself, use this skill — it catches issues you'd miss (tsconfig strictness, test exclusions, reward hacking patterns)."
disable-model-invocation: false
allowed-tools: Bash, Read, Grep, Glob
version: 1.1.0
---

# Validate Type Safety

Final verification gate before marking any TypeScript work complete. Combines type checking with reward hacking detection, test verification, and linting. ALL 5 steps must pass.

## In a validate stage: record, never fix

When `CATALYST_PHASE` or `CATALYST_STAGE` is `validate`, this skill is one gate of the validate ladder, and that stage produces verdicts, not fixes. Two rules replace the local ones below:

1. **Record, never fix.** A failing step is a finding with its `file:line`. Do not edit code and do not re-run after a fix: the remediate stage fixes it. Record the step's FAIL and return your verdict.
2. **Reuse the PR's CI before re-running suites.** Run each command below under a `timeout` well below the phase budget (for example `timeout 1200`), and never run the whole-monorepo suite when a narrower one covers the diff.
   - If the branch has a pull request whose head is `HEAD` (`gh pr view --json number,headRefOid`), read its checks (`gh pr checks --json name,state,bucket,link`). All required checks completed and passing means Step 4 is PASS: cite the run link, and run no suite yourself. A required check that failed means Step 4 is FAIL: cite that job's link.
   - If the checks at `HEAD` are still pending, there is no pull request, or `gh` cannot read it: run the type check, then only the test suites of the packages the diff touches, each under its own `timeout`.
   - If a command times out, record that step as not run with the timeout named. Never describe a tool you did not call as refused or blocked.
4. **A failure the branch did not introduce is pre-existing, not a FAIL.** Before recording a failing test, type error or lint error, check whether it also fails at the review base (`refs/catalyst/validate-base`, or the merge-base with the default branch): check out that path at the base in a scratch worktree, or read the PR's base-branch CI for the same check. If it fails there too, record the step PASS with `"preexisting":true` on the `type-safety` entry, and name the failing test or check and the base result in `detail`. FAIL only on failures this branch introduces. Info-level linter output (for example shellcheck `info` codes such as SC2015) never fails the step. Why: on 2026-09-26 to 09-28, CTC-2252, CTC-2570, CTC-3363 and CTC-3013 each failed type-safety only on failures carried in from main or on an info-level lint code (loop-audit, CTC-3912).
5. **Name the failing sub-step.** On a FAIL, the ladder's `type-safety` entry carries `substep`: the first step below that failed, as `typecheck` (Step 1), `reward-hacking` (Step 2), `test-inclusion` (Step 3), `tests` (Step 4) or `lint` (Step 5). The remediate stage reads it to pick its fix, so a flaky test never reads the same as a type error. Omit it on any other verdict.

Everywhere else (on a workstation, or when `/implement-plan` runs this as its gate) the local rules below apply, including fixing what fails.

## Tooling Detection

Before running any commands, detect the project's package manager and linting tool. Do NOT hardcode `bun`, `npm`, or `trunk` — detect from what's available.

### Package Manager

Check for lockfiles in the project root:

| Lockfile | Package Manager | Run Command |
|----------|----------------|-------------|
| `bun.lockb` or `bun.lock` | bun | `bun run` |
| `pnpm-lock.yaml` | pnpm | `pnpm run` |
| `yarn.lock` | yarn | `yarn run` |
| `package-lock.json` | npm | `npm run` |

If multiple exist, prefer in the order listed above. Store as `$PM_RUN` (e.g., `bun run`).

### Linter

Check for linting tools in this order:

| Check | Linter | Command |
|-------|--------|---------|
| `.trunk/` directory exists | Trunk | `trunk check --ci --upstream origin/main` |
| `biome.json` or `biome.jsonc` exists | Biome | `${PM_RUN} biome check .` |
| `eslint.config.*` or `.eslintrc.*` exists | ESLint | `${PM_RUN} eslint .` |

If none found, skip Step 5 and note it in the output.

### Type Check Command

Look for a `type-check` or `typecheck` script in `package.json`:
- If found: `${PM_RUN} type-check` (or `typecheck`)
- If not found: `npx tsc --noEmit` (fallback)

For monorepos, check if the root `package.json` has a workspace-level type-check script first.

## Validation Steps

### Step 0: tsconfig Strictness Check (Informational)

Read the project's `tsconfig.json` (or the tsconfig covering changed files in a monorepo). Verify:

- `"strict": true` is set — **WARN** if missing
- `"noUncheckedIndexedAccess": true` — **INFO** if missing (recommended)
- `"noImplicitReturns": true` — **INFO** if missing (recommended)
- `"exactOptionalPropertyTypes": true` — **INFO** if missing (recommended)

For monorepos: use the Glob tool to find `tsconfig.json` files, then identify which one covers the changed files (check `include`/`exclude` paths and `references`).

This step is **informational only** — it does not cause a FAIL verdict, but findings are reported.

### Step 1: Run TypeScript Type Check

```bash
${PM_RUN} type-check  # or detected equivalent
```

**Expected**: Zero errors, exit code 0.

If errors exist, they MUST be fixed. Do not proceed to Step 2 until type-check passes. (In a validate stage, record them instead; see "In a validate stage" above.)

### Step 2: Run Reward Hacking Scan

Execute the `/scan-reward-hacking` skill on the changed files, with `--base <ref>` set to the review base when there is one, so only lines the change added count toward the verdict.

**Expected**: PASS verdict with no unfixed CRITICAL or HIGH severity patterns.

### Step 3: Verify Test Inclusion

Check that test files are NOT excluded from type checking. Use Grep to search tsconfig files (in changed packages for monorepos):

- Pattern: `\.test\.ts` or `\.spec\.ts` in `exclude` arrays of tsconfig files
- Pattern: test directories in `exclude` arrays

**Expected**: No tsconfig files exclude test files from type checking.

### Step 4: Run Tests

```bash
${PM_RUN} test
```

For monorepos with many packages, if the project has a `--filter` or `--scope` option, run tests only for affected packages when possible.

**Expected**: All tests pass. Type fixes should not break functionality.

### Step 5: Lint Check

```bash
# Use detected linter command from Tooling Detection
trunk check --ci --upstream origin/main  # or biome/eslint equivalent
```

**Expected**: Zero lint errors.

If no linter was detected, skip this step and note it in the output.

### Optional: Type Coverage Metric

If `type-coverage` is available (check with `which type-coverage` or `npx type-coverage --help`), report the numeric coverage score:

```bash
npx type-coverage --at-least 0
```

This is informational only — does not affect the verdict.

## Output Format

Present results in this format:

```markdown
## Type Safety Validation Results

### Tooling Detected
- Package manager: {bun|pnpm|yarn|npm}
- Linter: {trunk|biome|eslint|none}
- Type check command: {detected command}

### Step 0: tsconfig Strictness (Informational)
- strict: true — {YES / MISSING}
- noUncheckedIndexedAccess — {YES / missing (recommended)}
- noImplicitReturns — {YES / missing (recommended)}
- exactOptionalPropertyTypes — {YES / missing (recommended)}

### Step 1: TypeScript Type Check
- Status: PASS / FAIL
- Errors: {count} (list if any)

### Step 2: Reward Hacking Scan
- Status: PASS / FAIL
- Critical: {count}
- High: {count}
- (Details if any issues found)

### Step 3: Test File Inclusion
- Status: PASS / FAIL
- tsconfig files excluding tests: {count} (list if any)

### Step 4: Tests
- Status: PASS / FAIL
- Failed tests: {count} (list if any)

### Step 5: Lint Check
- Status: PASS / FAIL / SKIPPED (no linter detected)
- Errors: {count} (list if any)

### Type Coverage (if available)
- Coverage: {X}% ({Y}/{Z} types)

---

## Overall Verdict: PASS / FAIL

{If FAIL, list all items that must be fixed}
```

## Verdict Criteria

**PASS** requires ALL of the following:
- [ ] Type check exits with code 0
- [ ] No CRITICAL or HIGH severity reward hacking patterns
- [ ] No tsconfig files exclude test files (in changed packages)
- [ ] All tests pass
- [ ] Lint check passes (or no linter detected)

**FAIL** if ANY check fails because of this branch. In a validate stage, a failure that also reproduces at the review base is pre-existing (rule 4 above), and info-level linter output never fails.

## If Validation Fails

In a validate stage, stop here: the FAIL and its findings are the result (see "In a validate stage" above). Everywhere else, do NOT mark the work as complete. Instead:

1. **Fix all issues** identified in the validation
2. **Re-run validation** after fixes
3. **Only mark complete** when validation passes

## Fast-Fail Mode

For efficiency, stop on the first failing step. Report which step failed and what needs fixing. Re-run the full validation after fixes are applied.

## Integration with Other Skills

- Called by `/implement-plan` as part of quality gates
- Called by `/oneshot` Phase 4 (Validate + Quality Gates)
- Invokes `/scan-reward-hacking` internally for Step 2
