# The sibling-skip guard

Linear's GitHub integration links any ticket token (`TEAM-123`) it finds in a branch name or PR body. For a ticket other than this PR's own, that link can move the other ticket's state, for example from Done back to in progress, when the PR opens or merges.

- Refer to related work by its GitHub PR number (`#123`). The PR's own `Fixes <ticket URL>` line stays: that link is intended.
- Before writing the body anywhere, append a `skip <TOKEN>` line (Linear's documented negative keyword) for every other ticket token the branch or body carries. `scripts/lib/linear-pr-skip.sh` does this in two modes: `linear_sibling_skip_block_from_branch` reads the branch slug, and `linear_sibling_skip_block_from_body` reads the body. Run both and keep one line per token, as [write-back.md](write-back.md) shows.
