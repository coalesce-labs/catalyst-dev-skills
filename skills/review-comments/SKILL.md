---
name: review-comments
description: "Pull, categorize and address every review comment on a PR (change requests, questions, suggestions): fetches them with gh api, verifies and fixes what is valid, drafts replies for the rest, defers low-priority bot findings to follow-up tickets, pushes one commit and resolves the threads. ALWAYS use when the user says 'address comments', 'fix review feedback', 'respond to reviewers', or mentions that a PR has unresolved comments or review threads."
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
version: 1.0.0
argument-hint: "[PR-number]"
---

# Review Comments

Resolve all actionable review feedback on a PR in one pass, so it can move forward.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

**Headless.** When `CATALYST_PHASE` is set or `--headless` is passed, read `${CLAUDE_SKILL_DIR}/references/headless.md`: there is no stdin, so disagreements are recorded instead of prompted.

## Input

Use the PR number from `$ARGUMENTS`. Otherwise detect the current PR, and ask the user if none is found:

```bash
PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null)
```

## Step 0: Read the rules

Read `${CLAUDE_SKILL_DIR}/assets/references/resolving-review-findings.md` before triaging anything, and follow it for every comment. It owns verification, classification (`valid`, `invalid`, `already-fixed`, `pre-existing/out-of-scope`, `needs-human`), diff scope, reply wording and escalation. This skill keeps the GitHub mechanics and the per-reviewer round policy.

## Step 1: Fetch comments and reviews

Run the fetch commands in `${CLAUDE_SKILL_DIR}/references/github.md`: inline review comments, review bodies, and issue comments. Group comments into threads by `in_reply_to_id`, and read the whole thread before acting: later replies may refine or resolve earlier ones.

## Step 2: Find each finding's review round

Track the round per reviewer login with `review_round_for_bot` from the same reference, since a PR can have more than one automated reviewer. P0/P1 is fixed in every round. P2/P3 is a judgment call in round 1 and always deferred from round 2 on.

## Step 3: Categorize and address each comment

Record each actionable comment's file and line, its claim, its thread and its class (reference rule 2). Then act, in order:

- **Code change requested:** verify the claim at HEAD (rule 3), then fix a `valid` finding with the smallest diff and one regression test (rules 4 to 6). Draft the evidence reply for `invalid` or `already-fixed` (rule 7).
- **Question:** read the context and draft a reply.
- **Optional suggestion:** implement it if it improves the code; otherwise explain the trade-off.
- **Low priority per the round policy, or `pre-existing/out-of-scope`:** defer it; read `${CLAUDE_SKILL_DIR}/references/deferring.md`.
- **Approval, praise, or an already-resolved thread:** no action.

**Disagreements come first.** When a suggestion would introduce a regression, reduce type safety or break project conventions, whatever its priority or round, draft a reply explaining the trade-off and let the user decide. Decide this before applying the round policy: a P2 tag does not make a finding non-judgmental.

```
Reviewer @name suggested X on file.ts:42.
I think this would [concern]. Draft reply:
  "Kept Y rather than X: [reason, with file:line or test evidence]."
Post this reply? [y/N]
```

## Step 4: Commit and push

Self-review the diff (reference rule 11), then stage only the files changed to address comments:

```bash
# Stage specific changed files (NOT git add -A which could catch unrelated changes)
git add path/to/changed-file1.ts path/to/changed-file2.ts
git commit -m "address review comments from PR #${PR_NUMBER}"
git push
```

## Step 5: Resolve the threads

Follow `"${CLAUDE_SKILL_DIR}/assets/references/review-thread-resolution.md"`: fetch unresolved threads via GraphQL, resolve each addressed one with the `resolveReviewThread` mutation, and verify the remaining count. Resolve a thread when a fix was pushed, a reply was posted, or it was deferred to a ticket. Leave a thread you could not address unresolved for human review.

## Output

Report in the shape of `${CLAUDE_SKILL_DIR}/references/output.md`: addressed, answered, disagreements, deferred, no action, and a summary with the commit.
