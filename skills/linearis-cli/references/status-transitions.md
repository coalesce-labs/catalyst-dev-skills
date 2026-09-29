# Status transitions — UUID calls and the team-key cache

The `stateMap` slot table lives in `SKILL.md` → "Workflow: Status Transitions"; this file is the detail behind it. A status transition here answers an operator's explicit request for a move off the cloud; no coding skill runs one. Cards move by events: the cloud moves a ticket when a phase outcome is recorded and when its PR merges. On a cloud account, a requested move is `catalyst write state <ticket> --slot <slot>`.

## Common flow

⛔ **The stage name is resolved, never typed.** `--status` takes whatever THIS cloud account calls the stage, and a name it does not use fails EMPTY rather than erroring. `linear-transition.sh` owns the one resolution chain; `--print-state` is its read-only, linearis-free, ticket-free form (it needs `jq`, and exits non-zero without it rather than printing a bootstrap it cannot verify).

⚠️ **In a script, assign before you query.** `linearis … --status "$(state done)"` swallows a refusal — a command substitution used as an argument does not propagate its exit status — so `linearis` runs with an empty `--status` and returns nothing. `DONE=$(state done) || exit 1` propagates; the examples below are interactive one-liners where you would see the error.

```bash
state() { bash "${CLAUDE_SKILL_DIR}/scripts/linear-transition.sh" --print-state --transition "$1" --team "$TEAM"; }

linearis issues update ENG-123 --status "$(state inProgress)"
linearis issues update ENG-123 --status "$(state inReview)"
linearis issues update ENG-123 --status "$(state done)"

# With comment — an AGENT posting the "Merged" note goes through linear-reply.mjs, not `discuss`
linearis issues update ENG-123 --status "$(state done)"
direnv exec . node "${CLAUDE_SKILL_DIR}/scripts/linear-reply.mjs" ENG-123 --as <AGENT> --body "Merged: PR #456" --top
```

Better still for a whole transition: `linear-transition.sh --ticket ENG-123 --transition done` does the resolve, the idempotency read and the write in one call.

## UUID-based calls

When `.catalyst/config.json` contains `catalyst.linear.stateIds`, prefer passing the UUID directly to `--status` instead of the display name. Every linearis resolver short-circuits on UUIDs — zero resolution API calls. The `linear-transition.sh` helper does this automatically.

```bash
# Resolve and cache UUIDs once (single GraphQL query)
"${CLAUDE_SKILL_DIR}/scripts/resolve-linear-ids.sh"

# Then transitions use UUIDs from config — 1 fewer API call per update
"${CLAUDE_SKILL_DIR}/scripts/linear-transition.sh" --ticket ENG-123 --transition done
```

## Team-key allowlist cache

The PR-body guard `scripts/lib/linear-pr-skip.sh` (carried by the `create-pr` and `describe-pr` skills) optionally filters its output through a cached snapshot of workspace team keys at `${XDG_CONFIG_HOME:-$HOME/.config}/catalyst/linear-team-keys.json`. The cache is **manual** and **fail-open** — when the file is missing, empty, malformed, or unreadable, the helper does no filtering. Populate / refresh it with:

```bash
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/catalyst"
linearis teams list --json |
  jq '{keys:[.nodes[].key]|sort, fetched_at:(now|todate)}' \
  > "${XDG_CONFIG_HOME:-$HOME/.config}/catalyst/linear-team-keys.json"
```

Re-run after onboarding a new Linear team. The helper is invoked inside non-interactive `gh pr create` / `gh pr edit` paths — no automatic refresh is wired in.
