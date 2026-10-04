# Post-merge deploy verification

The callable check for merge-pr acceptance: confirm a squash-merged change actually **deployed** and passes a **live smoke check**, through a cloud event wait when the CLI is available. Invoke after Step 13 in [post-merge.md](post-merge.md), passing the REST-confirmed `merge_commit_sha` (never a local `git rev-parse HEAD` — see the Step 9 note in [worktree-safe-merge.md](worktree-safe-merge.md)), or standalone by anyone given that SHA and a PR number.

⚠️ `merge-pr` is a portable skill installed across many repos, and this file maps the deploy surfaces of one repository only: the public catalyst repository (`coalesce-labs/catalyst`). `verify_post_merge_deploy` gates on repo identity first and returns `NO_DEPLOY_CONFIG` — not `NOT_APPLICABLE` — for every other repo, so a consuming repo without an equivalent mapping gets an honest "unconfigured" answer instead of a silently wrong one.

## What "deployed" means in the catalyst repository — two surfaces, not one

`coalesce-labs/catalyst` is a plugin/skills repo. It has no Worker API to smoke-test. Its deploy surface splits in two, and only one of them has a live check available — say so honestly rather than fabricating a check for the other:

| Surface | Trigger | Live signal |
|---|---|---|
| Docs/marketing site (`website/**`), Astro Starlight on Cloudflare Pages | CF's **native GitHub integration** — no `.github/workflows/*.yml` for it. Build watch paths = `website/**` only (see that repo's `docs/ci-required-checks-rollout.md`). CF posts **no status at all** when a push doesn't match the watch paths — that's a documented CF behavior, not a gap in this check. | The `Cloudflare Pages` commit **status** (Statuses API, not check-runs) on the merge commit, then a live fetch of `https://catalyst.coalescelabs.ai`. |
| Everything else — `plugins/**`, `scripts/**`, non-website docs (the overwhelming majority of merges) | The plugin marketplace (`.claude-plugin/marketplace.json`) points `source` at `./plugins/<name>` **in that same git repo**. There is no build, publish, or CDN step — a consumer's marketplace refresh reads straight from `main`. | **None distinct from the merge itself.** Landing on `main` *is* the deploy. |

The second row is the honest answer for most merges: there is nothing live to poll beyond the squash-merge readback `merge-pr` already does (`worktree-safe-merge.md`). Do not invent a smoke check here.

## The callable procedure

```bash
verify_post_merge_deploy() {
  local sha="$1" repo
  repo=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')

  # 0. This reference maps CATALYST'S OWN two deploy surfaces (below). A repo that isn't
  #    catalyst has no website/** docs site or catalyst.coalescelabs.ai to check — assuming
  #    every non-website merge there is NOT_APPLICABLE would be silently wrong. Gate on repo
  #    identity; a different repo needs its own equivalent mapping (see config-safety.md's
  #    `.catalyst/config.json` as the natural place to declare one — not built here, since no
  #    second repo's mapping exists yet to design against).
  if [[ "$repo" != "coalesce-labs/catalyst" ]]; then
    echo "NO_DEPLOY_CONFIG"
    return 0
  fi

  # 1. Is this merge docs-relevant? Same predicate CF's own watch paths use.
  local files; files=$(gh api "repos/${repo}/commits/${sha}" --jq '.files[].filename' 2>/dev/null)
  if ! echo "$files" | grep -q '^website/'; then
    echo "NOT_APPLICABLE"   # marketplace is git-native — merge to main IS the deploy
    return 0
  fi

  # 2. Capture a cloud cursor before the first status read. Deploy events need no ticket.
  local cloud=false event_status cursor next_cursor event_json event_type wait_rc
  local count=0 state deadline=$((SECONDS + 900)) wait_seconds
  if ! command -v catalyst >/dev/null 2>&1; then
    echo 'REST fallback: catalyst CLI absent; 30s interval, 30 reads maximum.' >&2
  elif event_status=$(catalyst events status --json 2>/dev/null); then
    cursor=$(printf '%s' "$event_status" | jq -er '.head | select(type == "number" and . >= 0 and . == floor)') || return 1
    cloud=true
  else
    echo 'REST fallback: catalyst events status failed; 30s interval, 30 reads maximum.' >&2
  fi
  while [ "$SECONDS" -lt "$deadline" ]; do
    state=$(gh api "repos/${repo}/commits/${sha}/status" \
      --jq '[.statuses[] | select(.context=="Cloudflare Pages")][0].state // "pending"') || { echo DEPLOY_ERROR; return 1; }
    case "$state" in
      success) break ;;
      failure|error) echo DEPLOY_FAILED; return 1 ;;
    esac
    if [ "$cloud" = true ]; then
      # Read again only after a selected event or a safety timeout.
      while [ "$SECONDS" -lt "$deadline" ]; do
        wait_seconds=$((deadline - SECONDS))
        [ "$wait_seconds" -le 30 ] || wait_seconds=30
        wait_rc=0
        event_json=$(catalyst events wait-for --after "$cursor" --timeout "$wait_seconds") || wait_rc=$?
        case "$wait_rc" in
          0)
            next_cursor=$(printf '%s' "$event_json" | jq -er '.sequence | select(type == "number" and . == floor)') || return 1
            [ "$next_cursor" -gt "$cursor" ] || return 1
            cursor=$next_cursor
            event_type=$(printf '%s' "$event_json" | jq -er '.type') || return 1
            case "$event_type" in
              github.deployment-status.*|github.workflow-run.completed|github.check-suite.completed|github.push) break ;;
            esac ;;
          1) break ;;
          130) return 130 ;;
          *)
            if catalyst events status --json >/dev/null 2>&1; then
              echo "cloud deploy wait failed (exit $wait_rc); stopping." >&2
              echo DEPLOY_ERROR; return 1
            fi
            cloud=false
            echo 'REST fallback: catalyst events status failed after wait error; 30s interval, 30 reads maximum.' >&2
            break ;;
        esac
      done
    else
      count=$((count + 1))
      [ "$count" -lt 30 ] || break
      sleep 30
    fi
  done
  if [ "$state" != success ]; then echo DEPLOY_PENDING; return 1; fi

  # 3. Live smoke check — the deployed site actually answers.
  local code; code=$(curl -sS -o /dev/null -w '%{http_code}' https://catalyst.coalescelabs.ai)
  if [ "$code" = "200" ]; then echo "DEPLOYED"; return 0; else echo "SMOKE_FAILED"; return 1; fi
}
```

Sentinels follow `bounded-poll.md`'s convention exactly: a distinct value per outcome, never a bare success-looking string, and the ceiling-hit case (`DEPLOY_PENDING`) is a documented terminal answer for this phase, not silently retried. The cloud wait has a 15-minute ceiling and a 30-second safety timeout. Only an absent CLI or failed status probe permits the [bounded-poll.md](bounded-poll.md) fallback, with 30 status reads at most. A failed GitHub read returns `DEPLOY_ERROR`; it never becomes pending or deployed.

## Why the Statuses API, not check-runs

`gh pr checks` merges both check-runs and legacy commit statuses into one display, which hides which API a given context actually uses. Cloudflare's GitHub integration posts via the older **Statuses API** (`GET /commits/{sha}/status`, not `/check-runs`) — confirmed against the catalyst repo's `docs/ci-required-checks-rollout.md` read recipe. Reading `/check-runs` for `Cloudflare Pages` would silently return nothing and read as "no evidence," which is a different failure than `DEPLOY_PENDING` above and should not be confused with it.

## Cloud events and authoritative status

The foreground wait uses `catalyst events wait-for` and retains its cursor. Deployment, workflow and check-suite events may have no ticket, so this watch selects types locally. An event only triggers a status read for the confirmed merge SHA. A successful event does not prove deployment. The Statuses API and the live smoke request remain authoritative. On a cloud timeout, read status once and continue the cloud wait. On a wait error, probe `catalyst events status` again; only a failed probe permits REST polling, with its reason printed once.
