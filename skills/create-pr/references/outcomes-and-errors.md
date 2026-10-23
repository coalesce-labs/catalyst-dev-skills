# Step 13 — Final State, Errors, and Examples

## Report the actual merge state — not just "PR created"

**CLEAN (ready to merge):**

```
✅ PR #{number} ready to merge

PR: #{number} - {title}
URL: {url}
Base: {base_branch}
Ticket: {ticket} (stays where it is until the PR merges)

Status:
  ✅ CI checks passed
  ✅ Review comments addressed ({N} resolved)
  ✅ No merge blockers

Merge with: the merge-pr skill
```

**Blockers remain:**

```
PR #{number} created — {N} blocker(s) remain

PR: #{number} - {title}
URL: {url}

Resolved:
  ✅ {what was fixed}

Still blocking:
  ❌ {specific blocker and exactly what's needed to resolve it}
```

## Arm the branch waiter

On a clean or a genuinely human-blocked outcome, run the arm snippet from [`../assets/references/branch-waiter.md`](../assets/references/branch-waiter.md): it keeps exactly one background wait on this branch's conflicts and messages and starts nothing when one already runs. The existing-PR path arms the same way — preflight's "D" (describe) choice leaves a PR open, so arm it after describing; "S" (skip) exits with no PR to watch, and skipping arms nothing. PENDING (the timeout ceiling) arms nothing too, and says why in one line: the monitoring ended without a terminal state, so there is no confirmed PR to wait on.

## Error handling

**On main/master:** `❌ Cannot create PR from main branch.` — suggest `git checkout -b TICKET-123-feature-name`.

**Rebase conflicts:** list conflicting files; instruct `git add <resolved-files>`, `git rebase --continue`, then re-run the `create-pr` skill.

**GitHub CLI not configured:** `gh auth login`, then `gh repo set-default`.

## Examples

**Branch `ENG-123-implement-pr-lifecycle`:**

```
Extracting ticket: ENG-123
Generated title: "ENG-123: Implement pr lifecycle"
Creating PR... ✅ PR #2 created
Running the describe-pr skill...
✅ Complete!
```

**Branch `feature-add-validation` (no ticket):**

```
No ticket found in branch name
Generated title: "Feature add validation"
Creating PR... ✅ PR #3 created
Running the describe-pr skill...
✅ Complete!
```

## Integration with other skills

- Runs the `commit` skill if there are uncommitted changes (optional).
- Always runs the `describe-pr` skill to generate the comprehensive description.
- Sets up for the `merge-pr` skill once the PR reaches a clean state.

## Remember

- **Never stop at "PR created"** — wait through `catalyst events wait-for`, then reread CI, reviews and PR state; address comments, fix CI failures, confirm clean merge state.
- **"PR created with auto-merge" is NOT done** — keep the cloud lifecycle watch until MERGED or genuinely human-blocked.
- Automated reviewer comments are yours to address, not the human's.
- Minimize prompts — only ask when a PR already exists. Auto-rebase, auto-describe.
- Fail fast on conflicts/errors.
