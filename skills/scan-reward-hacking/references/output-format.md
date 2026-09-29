# Output format

## Scan results

```markdown
## Reward Hacking Scan Results

**Scan scope**: {paths scanned}
**Diff base**: {ref, or "none (whole paths)"}
**Severity mode**: {library | app | mixed}

### CRITICAL (Must Fix Immediately)
- `file.ts:123` - `void (0 as unknown as Type)` - Lint suppression trick
- `packages/core/src/index.ts:45` - `as any` in library code

### HIGH SEVERITY (Must Fix Before Merge)
- `file.ts:456` - `as unknown as Campaign[]` - Missing documentation
- `file.ts:789` - `as any` in production code
- `file.ts:55` - `user!.name` - No runtime guard
- `file.ts:100` - `.forEach(async` - Silently drops promises
- `file.test.ts:12` - `it.skip(` - Test skipped instead of fixed
- `tsconfig.json:9` - `"exclude": ["src/legacy"]` added - Hides type errors

### MEDIUM SEVERITY (Should Fix)
- `file.ts:101` - `const _user = ...` - Unused local variable
- `apps/web/src/page.ts:30` - `item!.id` - No runtime guard (app code)

### ACCEPTABLE (No Action Needed)
- `file.test.ts:50` - `as any` in test mock
- `file.ts:200` - `as unknown as` with full documentation
- `file.ts:300` - `map.get(key)!` after `map.has(key)` guard

### Summary
- Critical: X issues
- High: Y issues
- Medium: Z issues
- Total requiring action: X + Y + Z
```

## Required fixes (on FAIL)

```markdown
## Required Fixes

1. `apps/api/src/services/UserService.ts:243`
   - Current: `as unknown as CreateUserRequest`
   - Fix: Fix the query return type or add Zod validation at the boundary

2. `apps/web/src/pages/Dashboard.tsx:117`
   - Current: `const _user = useUser();`
   - Fix: Delete the line entirely

3. `apps/web/src/pages/Dashboard.tsx:55`
   - Current: `items.forEach(async (item) => { ... })`
   - Fix: Use `for (const item of items) { await ... }` or `await Promise.all(items.map(...))`

4. `packages/core/src/client.ts:89`
   - Current: `this.config!.apiKey`
   - Fix: Add null check or use optional chaining (`this.config?.apiKey`)
```
