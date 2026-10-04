# Diagnose and resolve merge blockers

Read `${CLAUDE_SKILL_DIR}/assets/references/merge-blocker-diagnosis.md` for the blocker diagnosis and resolution rules. The cloud wait below takes precedence over that workflow's polling examples. Before waiting, inspect current-head checks and reviews with [gh-signal-traps.md](gh-signal-traps.md). Resolve known blockers first. When waiting on a queue, keep listening until GitHub confirms this PR merged.

## Cloud lifecycle wait

Capture the cloud head before reading GitHub, retain `EVENT_CURSOR` across pushes, and replay from it on the next wait. The CLI accepts a single `--type`, so this watch selects the lifecycle types locally after `catalyst events wait-for`. Avoid a ticket filter here because a check suite or base push can carry no ticket. For a known ticket-linked merge-only wait, use `catalyst events wait-for --type github.pr.merged --ticket "$ticket" --after "$EVENT_CURSOR" --timeout 300` once other gates are satisfied.

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner') || exit 1
CLOUD_EVENTS=false
if ! command -v catalyst >/dev/null 2>&1; then
  echo 'REST fallback: catalyst CLI absent; 300s interval, 24 reads maximum.' >&2
elif EVENT_STATUS=$(catalyst events status --json 2>/dev/null); then
  EVENT_HEAD=$(printf '%s' "$EVENT_STATUS" | jq -er '.head | select(type == "number" and . >= 0 and . == floor)') || exit 1
  EVENT_CURSOR=${EVENT_CURSOR:-$EVENT_HEAD}
  CLOUD_EVENTS=true
else
  echo 'REST fallback: catalyst events status failed; 300s interval, 24 reads maximum.' >&2
fi

# Read after capturing the cursor, so an event arriving during this read is replayed.
PR_DATA=$(gh api "repos/${REPO}/pulls/${pr_number}") || exit 1
PR_FALLBACK_READS=${PR_FALLBACK_READS:-0}
PR_WAIT_DEADLINE=${PR_WAIT_DEADLINE:-$((SECONDS + 7200))}
while [ "$SECONDS" -lt "$PR_WAIT_DEADLINE" ]; do
  PR_STATE=$(printf '%s' "$PR_DATA" | jq -er 'if .merged then "MERGED" elif .state == "closed" then "CLOSED" elif .state == "open" then "OPEN" else error("unknown PR state") end') || exit 1
  case "$PR_STATE" in
    MERGED) echo MERGED; break ;;
    CLOSED) echo CLOSED; exit 1 ;;
  esac
  EVENT=''
  if [ "$CLOUD_EVENTS" = true ]; then
    WAIT_SECONDS=$((PR_WAIT_DEADLINE - SECONDS))
    [ "$WAIT_SECONDS" -le 300 ] || WAIT_SECONDS=300
    WAIT_RC=0
    EVENT_JSON=$(catalyst events wait-for --after "$EVENT_CURSOR" --timeout "$WAIT_SECONDS") || WAIT_RC=$?
    case "$WAIT_RC" in
      0)
        NEXT_CURSOR=$(printf '%s' "$EVENT_JSON" | jq -er '.sequence | select(type == "number" and . == floor)') || exit 1
        [ "$NEXT_CURSOR" -gt "$EVENT_CURSOR" ] || exit 1
        EVENT_CURSOR=$NEXT_CURSOR
        EVENT=$(printf '%s' "$EVENT_JSON" | jq -er '.type') || exit 1
        case "$EVENT" in
          github.pr.merged|github.pr.closed|github.check-suite.completed|github.pr-review.submitted|github.pr-review-comment.created|github.pr-review-thread.resolved|github.issue-comment.created|github.pr.synchronize|github.push) ;;
          *) continue ;;
        esac ;;
      1) : ;; # Timeout: one authoritative read, then keep the same cursor.
      130) exit 130 ;;
      *)
        if catalyst events status --json >/dev/null 2>&1; then
          echo "cloud wait failed (exit $WAIT_RC); stopping." >&2; exit 1
        fi
        CLOUD_EVENTS=false
        echo 'REST fallback: catalyst events status failed after wait error; 300s interval, 24 reads maximum.' >&2
        [ "$PR_FALLBACK_READS" -lt 24 ] || { echo PENDING; exit 1; }
        PR_FALLBACK_READS=$((PR_FALLBACK_READS + 1)) ;;
    esac
  else
    [ "$PR_FALLBACK_READS" -lt 24 ] || { echo PENDING; exit 1; }
    [ "$PR_FALLBACK_READS" -eq 0 ] || sleep 300
    PR_FALLBACK_READS=$((PR_FALLBACK_READS + 1))
  fi
  # Exactly one PR read per selected event or timeout; never infer merge from an event.
  PR_DATA=$(gh api "repos/${REPO}/pulls/${pr_number}") || exit 1
  HEAD_SHA=$(printf '%s' "$PR_DATA" | jq -er '.head.sha') || exit 1
  if [ -n "$EVENT" ] && [ "$(printf '%s' "$PR_DATA" | jq -r '.merged or (.state == "closed")')" != true ]; then
    echo "OPEN head=$HEAD_SHA wake=$EVENT"
    break # Continue with CI and review resolution below, at this head.
  fi
  if [ "$CLOUD_EVENTS" = false ]; then
    CHECKS=$(gh api "repos/${REPO}/commits/${HEAD_SHA}/check-runs") || exit 1
    REVIEWS=$(gh api "repos/${REPO}/pulls/${pr_number}/reviews") || exit 1
    if printf '%s' "$CHECKS" | jq -e 'any(.check_runs[]; .status == "completed")' >/dev/null ||
       printf '%s' "$REVIEWS" | jq -e 'length > 0' >/dev/null; then
      echo "OPEN head=$HEAD_SHA; inspect checks and reviews"
      break
    fi
  fi
done
[ "$SECONDS" -lt "$PR_WAIT_DEADLINE" ] || { echo PENDING; exit 1; }
```

Resume blocker resolution after an `OPEN` wake. Read checks and reviews at `HEAD_SHA`, including the repository's review-evidence gate and unresolved threads. A finished check suite can be green or red; both need a recheck. New reviews include approvals, changes requested, inline findings and reaction-only signals. Do not infer the outcome or the reviewer identity from the event. Read them from GitHub. An unrelated account event cannot make this PR ready.

On a timeout, reread state once and retain the cursor. The session's ceiling is two hours, shared across resumes through `PR_WAIT_DEADLINE`. The fallback's 24-read cap also survives resumes through `PR_FALLBACK_READS`. A REST failure stops the wait rather than becoming OPEN. A failed cloud wait permits REST polling only when a new `catalyst events status` probe fails. Report that reason in one line. An available cloud connection never enters a sleep loop.

## Resolve the current blockers

| Blocker | Action |
|---|---|
| BEHIND | Update the branch, then wait from the retained cursor. |
| DIRTY | Rebase against the base; report unresolvable conflicts. |
| draft | Mark ready after exact-head validation and review. |
| UNSTABLE | Read the failing check, fix and push, then resume the cloud wait. |
| unresolved threads | Address automated findings through `review-comments`; keep human conversations for their author. |
| changes requested | Address the findings and request another review. |
| review required | Report the approval requirement after resolving addressable findings. |
| HAS_HOOKS | Wait for the next cloud event or safety timeout, then reread. |
| UNKNOWN | Read branch protection requirements and report each missing gate. |

Bound resolution to three rounds. A clean snapshot proceeds through the repository's configured merge route. The queue owns a queued merge. When REST confirms MERGED, capture `merged_at` and `merge_commit_sha` from that same response and continue cleanup.

If `SIGNAL_FILE` is set, write the confirmed merge time and terminal status immediately:

```bash
if [ -n "${SIGNAL_FILE:-}" ] && [ -f "$SIGNAL_FILE" ]; then
  PR_MERGED_AT=$(printf '%s' "$PR_DATA" | jq -er '.merged_at') || exit 1
  jq --arg ts "$PR_MERGED_AT" \
    '.pr.ciStatus = "merged" | .pr.mergedAt = $ts | .status = "done" | .updatedAt = $ts | .completedAt = $ts' \
    "$SIGNAL_FILE" > "$SIGNAL_FILE.tmp" && mv "$SIGNAL_FILE.tmp" "$SIGNAL_FILE"
fi
```
