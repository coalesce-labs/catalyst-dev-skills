# Judging matches

Worked examples for the "Acceptable when" column of the pattern table in `SKILL.md`.

## 1. `as unknown as`

Acceptable, with the documentation the pattern requires:

```typescript
// LIBRARY TYPE LIMITATION: The thirdPartyWrapper() function returns a type
// that TypeScript can't verify implements the expected interface.
// Verified at runtime that the object has the required methods.
// TODO: Remove when library updates types (tracked in TICKET-XXX)
const wrapped = thirdPartyResult as unknown as ExpectedInterface;
```

Not acceptable, undocumented:

```typescript
const campaigns = result as unknown as Campaign[];
```

## 2. `as any`

Acceptable only in a test mock:

```typescript
// In test file only
const mockDb = { query: vi.fn() } as any as Database;
```

Not acceptable in production code:

```typescript
const data = response.data as any;
```

## 3. Void tricks

Never acceptable:

```typescript
void (0 as unknown as _Type); // Lint suppression trick
void _schemaCheck; // Unused variable suppression
```

## 4. Underscore-prefixed names

Acceptable as a function parameter:

```typescript
function handleEvent(_event: Event, data: Data) {
  return process(data);
}
```

Not acceptable as a local variable. The fix is to delete the line:

```typescript
const _user = useUser(); // Keep for future use  <- DELETE THIS
```

## 5. `@ts-ignore` / `@ts-expect-error`

Acceptable, rarely, with a stated reason and a tracking ticket:

```typescript
// @ts-expect-error — library types are wrong, fixed in next release (PROJ-456)
const result = brokenLib.doThing();
```

Not acceptable without one:

```typescript
// @ts-ignore
const data = thing.stuff;
```

## 6. Non-null assertions

Acceptable after a runtime guard:

```typescript
if (user != null) {
  return user!.name; // Guard exists above
}

if (map.has(key)) {
  return map.get(key)!; // Safe — has() guarantees existence
}
```

Not acceptable with no guard:

```typescript
const name = user!.name; // Could be null at runtime
return this.user!.email; // Could crash at runtime
```

## 7. `forEach(async`

Never acceptable, because the promises are dropped:

```typescript
items.forEach(async (item) => {  // Promises silently dropped
  await processItem(item);
});
```

## 9 to 12. Suppressions, skipped tests and tsconfig changes

`@ts-nocheck` switches type checking off for a whole file. A lint suppression hides the finding the linter exists to report. A skipped test stops checking what it checked, and a focused test skips every other test in its file. A loosened or excluding tsconfig hides type errors from the check.

None is acceptable on a line the change added. One that predates the change is listed under ACCEPTABLE as pre-existing.
