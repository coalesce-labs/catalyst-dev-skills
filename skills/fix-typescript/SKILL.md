---
name: fix-typescript
description: "Fix TypeScript errors with strict anti-reward-hacking rules. **ALWAYS use when** the user says 'fix type errors', 'fix typescript', 'type-check is failing', or when TypeScript compilation errors need to be resolved. Ensures runtime type safety — fixes root causes instead of silencing errors with casts."
disable-model-invocation: false
allowed-tools: Read, Edit, Bash, Grep
version: 1.2.0
---

# Fix TypeScript Errors

Fix TypeScript type errors for **runtime type safety**, not just to satisfy the linter. If a fix would pass `tsc` but could still crash at runtime, it's wrong.

## Forbidden patterns

The canonical, exhaustive forbidden-pattern table — `as any`, `as unknown as`, `@ts-ignore` / `@ts-expect-error`, void tricks, underscore-prefixed unused locals, non-null assertions without a guard, `forEach(async`, and exported unused types, each with severity and acceptable/unacceptable examples — lives in the `scan-reward-hacking` skill. Run it before marking this work complete; don't re-derive the list here.

The scan also reports the suppressions a fix is most tempted to add: `@ts-nocheck`, `eslint-disable`, `biome-ignore`, `.skip` / `.only` on a test, a loosened `tsconfig` compiler option, and a new `tsconfig` `exclude`. None of them is a fix.

One more rule is process-level, so the scan cannot see it: never **comment out code** instead of deleting it (git has history).

## Stricter than the canonical scan

Three cases the canonical scan accepts are not acceptable here, because you are actively fixing the error rather than auditing pre-existing code: an exported-but-unused type must be removed or unexported outright, not left as the canonical scan's informational note; `@ts-ignore` / `@ts-expect-error` are never acceptable, even with a documented reason and tracking ticket — fix the error instead of suppressing it; and a test mock's `as any` is not a license to introduce a new one while you're resolving a production type error.

## In a remediate stage: work from the ladder

When `CATALYST_PHASE` or `CATALYST_STAGE` is `remediate`, a validate run already found the errors. Do not start with a fresh whole-repo run: it re-finds defects this branch did not introduce and burns the phase budget.

1. **Read the list.** Open `$CATALYST_ARTIFACT_DIR/prior/validation.md` and take the last `catalyst-validation-ladder` block. The `type-safety` entry's `substep`, `findings` and `detail` are the work; the prose above the block has the full error text.
2. **Skip what the branch did not introduce.** An entry or finding marked `"preexisting":true` reproduces on the merge-base. Leave it alone and do not count it.
3. **Fix by sub-step.**
   - `typecheck`: fix each cited error at its source, per the rules below.
   - `reward-hacking`: remove the hack by fixing the type it was hiding.
   - `test-inclusion`: remove the `tsconfig` `exclude` and fix whatever errors it was hiding.
   - `tests`: reproduce the failing test before editing. If it passes on a rerun without a change, it is flaky: say so, and do not edit code to chase it.
   - `lint`: fix what the rule flags. Never disable the rule.
   - No `substep`: read `detail` and the prose to find which of the five failed.
4. **Prove it narrowly, then with the repository's gate.** Re-run only the failing check, scoped to the packages you touched. The final gate is the repository's own gate command, as the dispatch prompt names it; never substitute a package manager's default.
5. **Scan your own change before you end.** Run the `scan-reward-hacking` skill over the files you changed: `git diff --name-only HEAD` plus `git ls-files --others --exclude-standard`. Fix every CRITICAL or HIGH finding on a line you wrote.

## Fix at the source, not the consumer

```typescript
// WRONG - cast a query result
const users = (await db.from("users").select("*")) as unknown as User[];

// CORRECT - use the query builder's generic typing
const { data: users } = await db.from("users").select("*").returns<User[]>();
```

For **external data** (API requests, webhooks, uploads), validate with Zod at the boundary instead of casting:

```typescript
// WRONG
const webhook = req.body as WebhookPayload;
// CORRECT
const webhook = WebhookPayloadSchema.parse(req.body);
```

## When a type assertion is acceptable

Only for a **third-party library limitation**, documented with what was verified at runtime and a tracking ticket:

```typescript
// LIBRARY TYPE LIMITATION: thirdPartyWrapper() returns a type TS can't verify.
// Verified at runtime it has the required methods. TODO: remove when the library
// updates types (tracked in TICKET-XXX).
const wrapped = thirdPartyResult as unknown as ExpectedInterface;
```

## Process

1. Read the TypeScript error; find the root cause — why doesn't the type already match?
2. Fix at the source (the producing function/type), not the consumer.
3. Run the repository's own type check: the command its `AGENTS.md`, `CLAUDE.md` or CI names. If it names none, detect the package manager (`bun.lock` / `bun.lockb` / `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json`, else `npx tsc --noEmit`) and run its `type-check` script.
4. Run the `scan-reward-hacking` skill on the files you changed. Work is not complete until it passes.

## The golden rule

If you reach for `as`, ask "why doesn't the type already match?" and fix that instead. A type assertion means the source has wrong types (fix the source), external data wasn't validated (add Zod), or a library has incomplete types (document and track) — never use it to silence an error.
