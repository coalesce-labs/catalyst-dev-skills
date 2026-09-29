# Flags, Error Handling, and Examples

## Flags

**`--skip-tests`** — Skip local test execution.
**`--keep-branch`** — Don't delete local branch.

```text
merge-pr skill with: 123
merge-pr skill with: 123 --skip-tests
merge-pr skill with: 123 --keep-branch
merge-pr skill with: 123 --skip-tests --keep-branch
```

## Error handling

For all errors, provide clear messages with the specific error, what went wrong, and how to fix it. **Never give up with a generic message** — always diagnose the specific cause and provide actionable next steps.

**Fail fast (stop execution):**
- Rebase conflicts → show conflicting files, instructions to resolve manually, then re-run
- Test failures → show failed tests, suggest fix or `--skip-tests`
- PR not open/mergeable → show current state

**Diagnose and attempt to fix (Step 6 blocker loop):**
- CI checks failing → analyze failure, attempt code fix, re-push, re-poll
- Unresolved threads → run the `review-comments` skill, resolve threads
- Branch behind → rebase and push
- Draft PR → mark as ready
- Changes requested → check if addressed, suggest re-request review
- Infrastructure failures → suggest re-run, provide log URL

**Escalate with specifics (never generic):**
- Review required → tell user exactly how many approvals needed and who to request
- Unresolvable conflicts → list specific files and what conflicts exist
- Unknown blockers → query branch protection rules and list every requirement with its status

**Never suggest:**
- Force merge, admin override, or disabling branch protection
- Skipping required checks or reviews
- Any workaround that bypasses the protection rather than satisfying it

**Warn but continue (graceful degradation):**
- Branch deletion error → warn, merge already succeeded

## Remember

- **Never bypass branch protection** — diagnose and resolve blockers legitimately
- **Always squash merge** — clean history
- **Always delete branches** — no orphan branches
- **Always run tests** — unless explicitly skipped
- **Auto-rebase** — keep up-to-date with base
- **Diagnose, don't give up** — identify specific blockers and fix or explain them
- **Leave the ticket alone** — on Catalyst Cloud the merge moves it to done
