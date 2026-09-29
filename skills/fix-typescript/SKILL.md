---
name: fix-typescript
description: "Fix TypeScript errors at their root cause, for runtime type safety, under strict anti-reward-hacking rules. Use when the user says 'fix type errors', 'fix typescript' or 'type-check is failing', or whenever TypeScript compilation errors need resolving."
disable-model-invocation: false
allowed-tools: Read, Edit, Bash, Grep
version: 1.2.0
---

# Fix TypeScript Errors

Fix each type error so the code is safe at runtime, not just quiet under `tsc`. A fix that passes `tsc` but can still crash at runtime is wrong.

**In a remediate stage** (`CATALYST_PHASE` or `CATALYST_STAGE` is `remediate`), a validate run already found the errors: read [references/remediate-stage.md](references/remediate-stage.md) and work from its list instead of a fresh whole-repo run.

## Process

1. Read the error and find the root cause: why doesn't the type already match?
2. Fix it at the source (the producing function or type), not at the consumer.
3. Run the repository's own type check: the command its `AGENTS.md`, `CLAUDE.md` or CI names. If it names none, detect the package manager (`bun.lock` / `bun.lockb` / `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json`, else `npx tsc --noEmit`) and run its `type-check` script.
4. Run the `scan-reward-hacking` skill on the files you changed. The work is complete only when it passes.

## Rules

The `scan-reward-hacking` skill owns the forbidden-pattern checklist, with severities and examples. It also reports the suppressions a fix is most tempted to add: `@ts-nocheck`, `eslint-disable`, `biome-ignore`, `.skip` / `.only` on a test, a loosened `tsconfig` compiler option, and a new `tsconfig` `exclude`. None of them is a fix.

Because you are fixing errors rather than auditing old code, three rules are stricter than the scan:

- Remove or unexport an exported-but-unused type; the scan's informational note is not enough.
- Fix the error instead of adding `@ts-ignore` or `@ts-expect-error`, even with a documented reason and ticket.
- Keep `as any` out of new code, including when a test mock nearby already uses it.

Delete dead code rather than commenting it out; git keeps the history.

## Fix at the source

```typescript
// WRONG - cast a query result
const users = (await db.from("users").select("*")) as unknown as User[];

// CORRECT - use the query builder's generic typing
const { data: users } = await db.from("users").select("*").returns<User[]>();
```

Validate **external data** (API requests, webhooks, uploads) with Zod at the boundary instead of casting:

```typescript
// WRONG
const webhook = req.body as WebhookPayload;
// CORRECT
const webhook = WebhookPayloadSchema.parse(req.body);
```

A type assertion is acceptable only for a **third-party library limitation**, documented with what was verified at runtime and a tracking ticket:

```typescript
// LIBRARY TYPE LIMITATION: thirdPartyWrapper() returns a type TS can't verify.
// Verified at runtime it has the required methods. TODO: remove when the library
// updates types (tracked in TICKET-XXX).
const wrapped = thirdPartyResult as unknown as ExpectedInterface;
```

When you reach for `as`, the source has wrong types (fix the source), external data was not validated (add Zod), or a library has incomplete types (document and track).
