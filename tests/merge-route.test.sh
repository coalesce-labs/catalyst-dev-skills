#!/usr/bin/env bash
# merge-route.test.sh — merge-pr lets a repository's merge queue own the merge.
#
# Run: bash tests/merge-route.test.sh
#
# A repository with a Mergify queue merges every eligible PR itself; merge-pr waits for that merge
# and never calls `gh pr merge` on it. A held PR, or one on the queue's excluded paths, goes to a
# person. Only a repository with no queue is merged by the skill.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROUTE="$ROOT/skills/merge-pr/scripts/merge-route.sh"
MERGE_DOC="$ROOT/skills/merge-pr/references/squash-merge.md"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A stub gh: answers the PR read and the file list from fixtures, and logs every call.
mkdir -p "$TMP/bin"
cat >"$TMP/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >>"$GH_LOG"
[[ "${GH_FAIL:-}" == 1 ]] && { echo "gh: HTTP 502" >&2; exit 1; }
case "$*" in
  "pr merge"*) exit 0 ;;
  *"rules/branches/"*) [[ "${GH_RULES_FAIL:-}" == 1 ]] && exit 1; echo "${RULES_JSON:-[]}" ;;
  *"/files"*) printf '%s\n' "${PR_FILES:-src/x.ts}" | tr ' ' '\n' | jq -R . | jq -s 'map({filename: .})' ;;
  *"repos/"*"/pulls/"*)
    # Each read of the PR is one poll; with MERGE_AFTER=n the PR reads as merged from the n-th poll on.
    # Only the wait's whole-PR reads (no --jq) count as polls.
    n=$(cat "$POLLS" 2>/dev/null || echo 0)
    [[ "$*" != *"--jq"* ]] && { n=$((n + 1)); echo "$n" >"$POLLS"; }
    filter=.
    args=("$@"); for ((i = 0; i < ${#args[@]}; i++)); do [[ "${args[i]}" == --jq ]] && filter="${args[i + 1]}"; done
    if [[ -n "${MERGE_AFTER:-}" && "$n" -ge "$MERGE_AFTER" ]]; then
      jq '.merged = true | .merged_by = {login: "mergify[bot]"} | .merge_commit_sha = "abc1234"' "$PR_JSON"
    else
      cat "$PR_JSON"
    fi | jq -r "$filter"
    ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$TMP/bin/gh"

make_repo() { # make_repo <dir> <with-queue: yes|no>
  mkdir -p "$1"
  if [[ "$2" == yes ]]; then
    cat >"$1/.mergify.yml" <<'YML'
queue_rules:
  - name: default
    merge_method: squash
    queue_conditions:
      - -draft
      - label!=hold
      - label!=hold:hand-steps
      - -files~=^packages/schema/(src|drizzle)/
      - "-files~=migrations/"
      - -head~=^catalyst/wip/
YML
  fi
}
make_repo "$TMP/queued" yes
make_repo "$TMP/plain" no
# How PRs enter the queue, one repository per mechanism.
cat >>"$TMP/queued/.mergify.yml" <<'YML'
pull_request_rules:
  - name: enqueue any green, thread-clean, non-held PR
    conditions:
      - base=main
      - label!=hold
    actions:
      queue:
YML
mkdir -p "$TMP/autoqueue" "$TMP/by-label" "$TMP/by-comment"
printf 'queue_rules:\n  - name: default\n    autoqueue: true\n    merge_conditions:\n      - check-success=ci\n' >"$TMP/autoqueue/.mergify.yml"
cat >"$TMP/by-label/.mergify.yml" <<'YML'
queue_rules:
  - name: default
    merge_conditions:
      - check-success=ci
pull_request_rules:
  - name: queue when labelled
    conditions:
      - label=ready-to-merge
      - "#approved-reviews-by>=1"
    actions:
      queue:
        name: default
YML
printf 'queue_rules:\n  - name: default\n    merge_conditions:\n      - check-success=ci\n' >"$TMP/by-comment/.mergify.yml"
# A priority rule's positive label sets priority; it is not a way into the queue.
cat >>"$TMP/queued/.mergify.yml" <<'YML'
priority_rules:
  - name: customer-blocking
    conditions:
      - label=priority:customer
    priority: high
YML
# A label that is one alternative among others is not "apply it and the PR enters".
mkdir -p "$TMP/compound"
cat >"$TMP/compound/.mergify.yml" <<'YML'
queue_rules:
  - name: default
pull_request_rules:
  - name: queue approved or labelled
    conditions:
      - base=main
      - or:
          - label=ready-to-merge
          - "#approved-reviews-by>=2"
    actions:
      queue:
YML

pr_json() { # pr_json <merged> <labels-json-array>
  jq -n --argjson m "$1" --argjson l "$2" --arg h "${HEAD_REF:-feature/x}" \
    '{merged:$m, state:"open", merged_by:null, head:{ref:$h}, base:{ref:"main"}, labels:($l|map({name:.}))}' >"$TMP/pr.json"
}

route() { # route <repo-dir> -> the route printed
  GH_LOG="$TMP/gh.log" PR_JSON="$TMP/pr.json" PATH="$TMP/bin:$PATH" bash "$ROUTE" 42 "$1" 2>/dev/null
}

expect_route() { # expect_route <name> <repo> <want>
  local got
  got="$(route "$2")"
  [[ "$got" == "$3" ]] && ok "$1 → $3" || bad "$1 → want $3, got '${got}'"
}

echo "── merge-route.sh"
[[ -x "$ROUTE" ]] || { bad "merge-route.sh exists and is executable"; echo "merge-route.test.sh: $PASS passed, $FAIL failed"; exit 1; }

pr_json false '[]'; PR_FILES="src/x.ts" expect_route "an eligible PR where a queue action enqueues it" "$TMP/queued" "queue auto"
pr_json false '[]'; PR_FILES="src/x.ts" expect_route "an eligible PR where the queue rule autoqueues" "$TMP/autoqueue" "queue auto"
pr_json false '[]'; PR_FILES="src/x.ts" expect_route "a repository whose queue is entered by a label" "$TMP/by-label" "queue label ready-to-merge"
pr_json false '[]'; PR_FILES="src/x.ts" expect_route "a repository whose queue is entered by the queue command" "$TMP/by-comment" "queue comment"
pr_json false '[]'; PR_FILES="src/x.ts" expect_route "a label that is one alternative in the entry rule" "$TMP/compound" "queue unclear"
pr_json false '[]'; PR_FILES="apps/api/migrations/0042_add.sql" expect_route "an excluded PR in an auto-queue repo never waits" "$TMP/queued" hand-merge
pr_json false '[]'; PR_FILES="src/x.ts" RULES_JSON='[{"type":"merge_queue"}]' expect_route "a branch with GitHub's native merge queue" "$TMP/plain" "queue github"
pr_json false '[]'; PR_FILES="packages/schema/package.json" expect_route "a dependency-range edit under the schema package" "$TMP/queued" "queue auto"
pr_json false '[]'; PR_FILES="apps/api/migrations/0042_add.sql" expect_route "a migration, with no label (the queue's config alone excludes it)" "$TMP/queued" hand-merge
pr_json false '[]'; PR_FILES="packages/schema/src/tables.ts" expect_route "the schema package's published surface" "$TMP/queued" hand-merge
HEAD_REF=catalyst/wip/spike pr_json false '[]'; PR_FILES="src/x.ts" expect_route "a branch the queue excludes" "$TMP/queued" hand-merge
pr_json false '["hold:hand-steps"]'; PR_FILES="src/x.ts" expect_route "a PR the watchdog marked hold:hand-steps" "$TMP/queued" hand-merge
pr_json false '["hold"]'; expect_route "a PR held by a person" "$TMP/queued" held
pr_json false '["hold:pin-smoke"]'; expect_route "a PR held by the pin-smoke bot" "$TMP/queued" held
pr_json false '["hold"]'; expect_route "a held PR in a repo without a queue" "$TMP/plain" held
pr_json false '[]'; PR_FILES="src/x.ts" expect_route "a PR in a repo without a queue" "$TMP/plain" direct
pr_json false '[]'; PR_FILES="src/x.ts" GH_RULES_FAIL=1 expect_route "a repo whose branch rules cannot be read is never merged directly" "$TMP/plain" unknown
pr_json true '[]'; expect_route "an already-merged PR" "$TMP/queued" merged

pr_json false '[]'
got="$(GH_FAIL=1 route "$TMP/queued")"; rc=$?
[[ "$got" == unknown ]] && ok "an unreadable PR is never routed to a merge (got '${got}')" || bad "an unreadable PR routed to '${got}'"

echo "── squash-merge.md"
# Run the doc's merge block with the route fixed to each value and a wait that reports the merge;
# only the no-queue route may call `gh pr merge`.
block="$(awk '/^```bash$/{f=1;next} /^```$/{if(f){exit}} f' "$MERGE_DOC")"
[[ -n "$block" ]] || bad "squash-merge.md has a bash block"
run_block() { # run_block <route> -> gh log; the doc's messages land in $TMP/err
  : >"$TMP/gh.log"; rm -f "$TMP/polls"
  pr_json false '[]'
  (
    export GH_LOG="$TMP/gh.log" PR_JSON="$TMP/pr.json" POLLS="$TMP/polls" PATH="$TMP/bin:$PATH" CLAUDE_SKILL_DIR="$TMP/skill"
    export MERGE_AFTER="${MERGE_AFTER:-}" PAUSED_POLLS="${PAUSED_POLLS:-}"
    mkdir -p "$TMP/skill/scripts"
    printf '#!/usr/bin/env bash\necho "%s"\n' "$1" >"$TMP/skill/scripts/merge-route.sh"
    chmod +x "$TMP/skill/scripts/merge-route.sh"
    sleep() { :; }
    REPO=o/r pr_number=42
    eval "$block"
  ) >/dev/null 2>"$TMP/err"
  cat "$TMP/gh.log"
}
polls() { cat "$TMP/polls" 2>/dev/null || echo 0; }
for r in "queue auto" "queue label ready-to-merge" "queue comment" "queue unclear" hand-merge held merged unknown; do
  if MERGE_AFTER=2 run_block "$r" | grep -q "pr merge"; then bad "route '$r' never calls gh pr merge"; else ok "route '$r' never calls gh pr merge"; fi
done
run_block "queue auto" | grep -E "pr edit|pr comment" >/dev/null && bad "an automatic queue is never entered by hand" || ok "an automatic queue is never entered by hand"
run_block "queue label ready-to-merge" | grep "pr edit 42 --add-label ready-to-merge" >/dev/null && ok "a label-entered queue gets exactly its label" || bad "a label-entered queue gets exactly its label"
run_block "queue comment" | grep "pr comment 42 --body @mergifyio queue" >/dev/null && ok "a command-entered queue gets the queue command" || bad "a command-entered queue gets the queue command"
MERGE_AFTER=1 run_block "queue unclear" >"$TMP/unclear.log"
if grep -qE "pr edit|pr comment" "$TMP/unclear.log" || [[ "$(polls)" -gt 0 ]]; then
  bad "an unclear entry rule is reported, not acted on or waited on"
else
  ok "an unclear entry rule is reported, not acted on or waited on"
fi
cat >"$TMP/bin/mergify" <<'STUB'
#!/usr/bin/env bash
# Paused for the first PAUSED_POLLS polls of the PR, then running.
n=$(cat "$POLLS" 2>/dev/null || echo 0)
if [[ "$*" == "queue status --json"* ]]; then
  if [[ -n "${PAUSED_POLLS:-}" && "$n" -le "$PAUSED_POLLS" ]]; then echo '{"pause":{"reason":"hand-merge of #9"}}'; else echo '{"pause":null}'; fi
fi
STUB
chmod +x "$TMP/bin/mergify"
MERGE_AFTER=3 run_block "queue auto" >/dev/null
[[ "$(polls)" -eq 3 ]] && grep -q "merged by mergify\[bot\]" "$TMP/err" && ok "a queued PR is waited on until the queue merges it" || bad "a queued PR is waited on until the queue merges it (polls $(polls))"
run_block "queue auto" >/dev/null
[[ "$(polls)" -eq 30 ]] && grep -q "not merged yet" "$TMP/err" && ok "the wait ends after 30 polls when nothing merges" || bad "the wait ends after 30 polls when nothing merges (polls $(polls))"
PAUSED_POLLS=15 MERGE_AFTER=40 run_block "queue auto" >/dev/null
[[ "$(polls)" -eq 40 ]] && grep -q "merged by" "$TMP/err" && ok "polls while the queue is paused do not use up the wait" || bad "polls while the queue is paused do not use up the wait (polls $(polls))"
PAUSED_POLLS=999 run_block "queue auto" >/dev/null
grep -q "paused (hand-merge of #9)" "$TMP/err" && [[ "$(polls)" -lt 100 ]] && ok "a pause that outlasts its own bound is reported with its reason" || bad "a pause that outlasts its own bound is reported with its reason (polls $(polls))"
rm -f "$TMP/bin/mergify"
run_block "queue github" | grep "pr merge 42 --auto" >/dev/null && ok "GitHub's native queue is entered with gh pr merge --auto" || bad "GitHub's native queue is entered with gh pr merge --auto"
run_block direct | grep "pr merge 42 --squash" >/dev/null && ok "route direct merges with gh pr merge --squash" || bad "route direct merges with gh pr merge --squash"
[[ "$(grep -c 'gh pr merge' "$MERGE_DOC")" -ge 1 ]] || bad "squash-merge.md names gh pr merge for the no-queue route"

echo "merge-route.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
