# GitHub fetch commands

## Comments and reviews (Step 1)

```bash
# Get repo info
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')

# Get PR review comments (inline code comments) — includes file path and line
gh api "repos/${REPO}/pulls/${PR_NUMBER}/comments" \
  --jq '.[] | {id: .id, path: .path, line: .line, body: .body, user: .user.login, created: .created_at, in_reply_to: .in_reply_to_id}'

# Get PR reviews (top-level review bodies with approval state)
gh api "repos/${REPO}/pulls/${PR_NUMBER}/reviews" \
  --jq '.[] | {id: .id, state: .state, body: .body, user: .user.login}'

# Get issue comments (general PR conversation)
gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" \
  --jq '.[] | {id: .id, body: .body, user: .user.login, created: .created_at}'
```

## Review round per reviewer (Step 2)

A finding's round is how many reviews its own `.user.login` has submitted on this PR. Look it up per finding, from that finding's login.

```bash
# Round for a specific bot login = how many times that login has submitted a review on this PR.
review_round_for_bot() {
  local bot_login="$1"
  gh api "repos/${REPO}/pulls/${PR_NUMBER}/reviews" \
    --jq "[.[] | select(.user.login == \"${bot_login}\")] | length"
}
FINDING_BOT_LOGIN="…"   # the .user.login on the review/review-comment this finding came from
REVIEW_ROUND=$(review_round_for_bot "$FINDING_BOT_LOGIN")
```
