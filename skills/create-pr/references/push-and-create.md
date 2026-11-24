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

`draft_pr_push_verify` is the guarded helper every push site in this pack uses: a pre-push safety gate (placeholder-identity / anomalous tree-wide-deletion commits refuse with rc=4), a fast-forward push that is never forced, and a post-push origin==HEAD verify.

Branches are kept current while work is in flight, so the remote branch can hold a commit this seat did not write, such as the upkeep robot's merge of main. When the push is rejected because the branch moved, the helper fetches it and replays only the unpublished commits (those after the merge-base of HEAD and the remote tip) with `git rebase --onto <remote tip> <last published>`, then pushes fast-forward once more. The other writer's commits stay as they are.

| rc | What happened | What the seat does |
|---|---|---|
| 6 | The branch is stack-managed (its commits carry a Mergify `Change-Id` trailer). Nothing was replayed or pushed. | The local stack is authoritative: `mergify stack sync`, then `mergify stack push --keep-pull-request-title-and-body`. The push updates every pull request in the stack whose commit moved, not only this change's. With the option each existing pull request keeps its title and description, and a change with no pull request still gets one created from its commit. A plain stack push replaces the title and description of every existing one with its commit message. |
| 7 | Replaying conflicted. Nothing was pushed; the message names the conflicting files and the rebase is left in progress. | Resolve the files, `git add` them, `git rebase --continue`, then push again. |

Never fall back to `git push --force-with-lease` without an expected SHA: after any `git fetch` its lease matches the moved tip and overwrites the other writer's commit.

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

# On a Mergify stack, look before creating: after a stack push (Step 8, rc 6) this change already
# has a pull request, on the stack tool's own branch. An ordinary branch creates as before.
source "${CLAUDE_SKILL_DIR}/scripts/lib/draft-pr.sh"
LOOKUP_RC=0
pr_number="$(draft_pr_stack_change_number)" || LOOKUP_RC=$?
[[ $LOOKUP_RC -ne 0 ]] && { echo "create-pr: could not tell whether this stack change already has a pull request (rc=${LOOKUP_RC}); none was created" >&2; exit "$LOOKUP_RC"; }
if [[ -z "$pr_number" ]]; then
  pr_url="$(gh pr create --title "$title" --body "$body" --base "$base")" || exit 1
  pr_number="${pr_url##*/}"
fi
echo "$pr_number"
```

`draft_pr_stack_change_number` prints the open pull request of the change at HEAD when that change is on a Mergify stack, and nothing otherwise. It asks `mergify stack list --json` for the entry whose `Change-Id` is HEAD's, so a lower change's pull request is never taken for the one on top. An existing pull request keeps its title and description here, and Step 10 refines them.

| rc | What happened | What the seat does |
|---|---|---|
| 8 | HEAD is a stack change, and neither the stack's list nor the remote could say whether it has a pull request. Nothing was created. | Run the step again once `mergify stack list` or the remote answers. Do not create the pull request by hand, because that can open a second one. |

The commit-message body makes a new PR immediately readable even before the `describe-pr` skill runs.

## Step 10 — Run the describe-pr skill

Immediately run the `describe-pr` skill with `$pr_number` to generate the full description, refine the title, and save to `thoughts/`.

## Step 11 — Leave the ticket where it is

Opening a PR moves nothing: the ticket stays where it is until the PR merges. On Catalyst Cloud the cloud moves it when the phase outcome is recorded and again when the PR merges. Linear's GitHub integration (and the cloud, when connected) links the PR to the ticket by branch name or title, so post no comment about it. A person who asks for a move uses `catalyst write state <ID> --slot <slot>` (the Cloud pack's `catalyst-linear` skill), or, off the cloud, an operator moves it with the Linearis CLI directly.
