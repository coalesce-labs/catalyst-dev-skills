# Output format

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
