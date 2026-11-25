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

On a clean or a genuinely human-blocked outcome, run the `record` command below with the pull request and the ticket. It runs the arm function from [`../assets/references/branch-waiter.md`](../assets/references/branch-waiter.md), which keeps exactly one background wait on this branch's conflicts and messages and starts nothing when one already runs, and it puts this session on record as the reader. The arm function on its own leaves no reader on record, and the check then says so. The existing-PR path arms the same way — preflight's "D" (describe) choice leaves a PR open, so arm it after describing; "S" (skip) exits with no PR to watch, and skipping arms nothing. PENDING (the timeout ceiling) arms nothing more and stops nothing: a wait Step 9 started keeps running and the pull request is open. Skip the `record` below, run the `check`, and report its line beside the timeout.

## Check the end state

The create step already ran `scripts/pr-end-state.sh record` (Step 9), and the existing-PR path runs the same command after describing. Run it again here: when the create step's attempt failed (a failed event status read, a checkout off the head), its record says nobody reads the wait, and only a new `record` changes that. Then close the run with the check, and put the line it prints in the report:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/pr-end-state.sh" record "$repo" "$branch" "$pr_number" "${ticket:-}"
bash "${CLAUDE_SKILL_DIR}/scripts/pr-end-state.sh" check "$repo" "$branch" "$pr_number"
```

| rc | First word | What it means | What the seat does |
|---|---|---|---|
| 0 | `FINISHED` | The pull request is merged or closed. | Report the line. |
| 0 | `HANDED-OFF` | The pull request was sent to a ticket or a session, and the message id and an answer of `next-turn` or `next-phase` are on record. It is read first, so a wait still running on the branch does not hide it. | Report the line with the recipient. |
| 0 | `OWNED` | A waiter started in this checkout is running for this pull request, the agent session on record as its reader is alive, and this checkout is on the pull request's head. | Report the line. Ownership ends when that session's process does. An idle session still counts: the check cannot see whether it will take another turn. So does a long-lived background process that runs under a session's name, because a name cannot tell a session from a server. |
| 9 | `NEEDS ATTENTION` | No owner is shown. The pull request is open and no waiter could start, the waiter ended, the session that armed it is gone or was never named, the waiter is for another pull request or was started in another checkout, the checkout is not on the head, or the handoff on record is not a delivered one; or the pull request could not be read, and then its owner is unknown: it can be handed off or closed. | The run is not finished unattended. Fix what the line names (run `record` again, push or pull, check out the branch), or send the pull request to an owner and record the message id and answer with `handoff`, then check once more. If none of that is possible, report the line's reason: an open pull request that was read is unowned, and one that could not be read has an unknown owner. A message already sent does not finish the handoff then: keep its id and answer, run `handoff` with them again once the pull request can be read, and check once more. |

A reason is not an owner. A branch with no ticket key or a machine with no `catalyst` CLI stays `NEEDS ATTENTION` until the pull request is sent to someone and the channel's answer is recorded. A terminal, a multiplexer or a CI worker is not an owner either: only an agent session's own process is. A person who takes the pull request by another route is named in the report, and the check still says `NEEDS ATTENTION`.

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

**Branch `feature-add-validation` (no ticket):** no wait can start without a ticket key, so the run ends on `NEEDS ATTENTION` and names the next action, never `Complete`.

```
No ticket found in branch name
Generated title: "Feature add validation"
Creating PR... ✅ PR #3 created
Running the describe-pr skill...
NEEDS ATTENTION: pull request #3 is open and nothing owns it. branch-waiter: arm needs … a ticket key …
Next: send PR #3 to a ticket or a session with `catalyst inbox send`, then record the answer with
`pr-end-state.sh handoff`. Until then the report says PR #3 is unowned.
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
