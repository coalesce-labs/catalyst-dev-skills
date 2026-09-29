# Title, Push, and Create PR (Steps 7–11)

## Step 7 — Generate the PR title

PR titles follow `<type>(<scope>): <ticket> ...` so active work is identifiable from GitHub alone. Prefer the first commit subject (it carries type/scope); inject the ticket via `draft_pr_title`. Branch-derived title is the no-commit fallback.

```bash
source "${CLAUDE_SKILL_DIR}/scripts/lib/draft-pr.sh"
commit_subj=$(git log --no-merges --format='%s' "origin/${base}..HEAD" 2>/dev/null | tail -1)
if [[ -n "$commit_subj" ]]; then
    title="$(draft_pr_title "$ticket" "$commit_subj")"
elif [[ "$ticket" ]]; then
    title="$ticket: $(echo "$branch" | sed "s/^$ticket-//" | tr '-' ' ')"
else
    title="$(echo "$branch" | tr '-' ' ')"
fi
```

## Step 8 — Push

```bash
source "${CLAUDE_SKILL_DIR}/scripts/lib/draft-pr.sh"
PUSH_VERIFY_RC=0
VERIFIED_SHA="$(draft_pr_push_verify)" || PUSH_VERIFY_RC=$?
[[ $PUSH_VERIFY_RC -ne 0 ]] && { echo "create-pr: push-verify failed (rc=${PUSH_VERIFY_RC})" >&2; exit "$PUSH_VERIFY_RC"; }
```

`draft_pr_push_verify` is the guarded helper every push site in this pack uses: a pre-push safety gate (placeholder-identity / anomalous tree-wide-deletion commits refuse with rc=4), fast-forward-then-force-with-lease retry, and a post-push origin==HEAD verify.

## Step 9 — Create the PR

**No Claude attribution** — the PR body is authored solely by the git user; never add "Generated with Claude Code", "Co-Authored-By: Claude", or similar.

```bash
commits=$(git log origin/$base..HEAD --oneline --no-merges)
body="## Changes

$commits"
[[ "$ticket" ]] && body="$body

Refs: $ticket"

# Neutralize sibling Linear tokens embedded in the branch before
# they can auto-link on PR-open. Full rationale:
# the describe-pr skill's linear-sibling-guard reference — this call site is
# branch-only (the transient body here is assembled from commit subjects, not
# prose, so there's nothing for body-mode to scan).
# shellcheck source=/dev/null
source "${CLAUDE_SKILL_DIR}/scripts/lib/linear-pr-skip.sh"
skip_block="$(linear_sibling_skip_block_from_branch "$ticket" "$branch")"
[[ -n "$skip_block" ]] && body="$body

$skip_block"

gh pr create --title "$title" --body "$body" --base "$base"
```

The commit-message body makes the PR immediately readable even before the `describe-pr` skill runs.

## Step 10 — Run the describe-pr skill

Immediately run the `describe-pr` skill with the PR number to generate the full description, run verification, refine the title, and save to `thoughts/`.

## Step 11 — Leave the ticket where it is

Opening a PR moves nothing: the ticket stays where it is until the PR merges. On Catalyst Cloud the cloud moves it when the phase outcome is recorded and again when the PR merges. Linear's GitHub integration (and the cloud, when connected) links the PR to the ticket by branch name or title, so post no comment about it. A person who asks for a move uses `catalyst write state <ID> --slot <slot>` (the Cloud pack's `catalyst-linear` skill), or, off the cloud, the operator-only `linearis-cli` skill.
