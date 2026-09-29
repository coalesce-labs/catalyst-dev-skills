# Output format

```markdown
## PR Review Comments — #${PR_NUMBER}

### Comments Addressed

1. **@reviewer** on `path/to/file.ts:42`
   - Comment: "This should use optional chaining instead of non-null assertion"
   - Action: Changed `user!.name` to `user?.name ?? ''`

2. **@reviewer** on `path/to/file.ts:89`
   - Comment: "Missing error handling for the API call"
   - Action: Added try/catch with proper error propagation

### Questions Answered

3. **@reviewer** on general
   - Question: "Why did you choose X over Y?"
   - Reply: {drafted reply — post via gh api if requested}

### Disagreements (Needs Decision)

4. **@reviewer** on `path/to/file.ts:120`
   - Suggestion: "Use a map instead of switch"
   - Analysis: The switch is more readable here and has exhaustiveness checking.
   - Draft reply ready — awaiting your decision.

### Deferred to Follow-up (low priority, per round policy)

5. **@reviewer** on `path/to/file.ts:200`
   - Comment: "Consider extracting this into a helper"
   - Filed as: {TICKET-ID} — reply posted, thread resolved

### No Action Needed

6. **@reviewer**: "LGTM" (approval)

### Summary

- Code changes: {N}
- Questions answered: {N}
- Disagreements flagged: {N}
- Deferred to follow-up: {N}
- Skipped (resolved/approval): {N}
- Commit: {short hash} pushed to branch
```
