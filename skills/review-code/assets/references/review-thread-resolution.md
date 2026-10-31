# Review Thread Resolution Workflow

Shared workflow for posting a review as GitHub line comments, and for answering and resolving its threads after the fixes. Referenced by `/review-comments` (Step 5), `/review-code` when it posts to a PR, and the `unresolved-threads` blocker strategy in `merge-blocker-diagnosis.md`.

## Posting a review

Post findings as one GitHub PR review at the reviewed head, with one line comment per finding, never as one long PR comment. Each comment gives the severity, the finding and the fix. Any check run your process publishes for the review is still published; the PR review is in addition to it.

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
# findings.json: [{"path":"src/a.ts","line":40,"body":"P2: <finding>. Fix: <fix>."}, ...]
jq -n --arg sha "$REVIEWED_HEAD" --arg body "$SUMMARY" --slurpfile f findings.json \
  '{commit_id:$sha, event:"COMMENT", body:$body, comments:[$f[0][] | {path, line, side:"RIGHT", body}]}' \
  | gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" --input -
```

`line` must be a line the diff shows at that head; GitHub refuses the whole review if one comment is off the diff. Put a finding on an untouched line in the review body instead, naming its `path:line`.

## Step 1: Fetch Unresolved Review Threads

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
OWNER=$(echo "$REPO" | cut -d'/' -f1)
NAME=$(echo "$REPO" | cut -d'/' -f2)

gh api graphql -f query='
query($owner: String!, $name: String!, $pr: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes { body author { login } path line }
          }
        }
      }
    }
  }
}' -f owner="$OWNER" -f name="$NAME" -F pr="$PR_NUMBER"
```

## Step 2: Reply in Each Thread

After the fix commit is pushed, reply inside every thread it fixes: `Fixed in <sha>: <one line>`. For a finding left unfixed, reply with the reason or the follow-up ticket id. Never post the answer as a top-level PR comment.

```bash
gh api graphql -f query='
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) {
    comment { url }
  }
}' -f threadId="$THREAD_NODE_ID" -f body="Fixed in $FIX_SHA: $ONE_LINE"
```

## Step 3: Resolve Each Answered Thread

Resolve only what the Resolution Rules below allow:

```bash
gh api graphql -f query='
mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    thread { isResolved }
  }
}' -f threadId="$THREAD_NODE_ID"
```

## Resolution Rules

| Outcome | Action |
|---------|--------|
| **Fixed**, any reviewer | Reply `Fixed in <sha>: <one line>`, then resolve |
| **Not fixed** (disagreement, deferral, out of scope), from a person or a review agent that answers replies | Reply with the reason or the follow-up ticket id; leave it open until that reviewer or the PR owner agrees |
| **Deferred** from an automated review app that does not answer replies, with the follow-up ticket filed | Reply with the ticket id, then resolve |
| **Approval / praise** | Already not blocking — skip |
| **Could not address** | Do NOT resolve — leave for human review |

Tell them apart by who answers, not by the login type: a review agent can post through a GitHub App too. When you cannot tell, leave the thread open.

## Step 4: Verify

```bash
UNRESOLVED=$(gh api graphql -f query='
query($owner: String!, $name: String!, $pr: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes { isResolved }
      }
    }
  }
}' -f owner="$OWNER" -f name="$NAME" -F pr="$PR_NUMBER" \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length')

if [ "$UNRESOLVED" -gt 0 ]; then
  echo "$UNRESOLVED unresolved thread(s) remain — manual review needed"
fi
```
