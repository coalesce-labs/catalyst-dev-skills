#!/usr/bin/env bash
# existing-pr-lookup.test.sh — create-pr finds the pull request a stack push already opened (CTC-11407).
#
# Run: bash tests/existing-pr-lookup.test.sh
#
# On a Mergify stack the pull request's head is the stack tool's own branch, and the local branch is
# never pushed under its own name. A lookup by branch name finds nothing there, so create-pr used to
# run `gh pr create` for a change that already had a pull request. draft_pr_stack_change_number asks
# the stack's own list, keyed on HEAD's Change-Id. When the list cannot answer it asks the remote
# for the stack tool's branch, and when nothing can answer it returns 8 so no second pull request is
# created. An ordinary branch is left to the caller, as before.
#
# No network: `gh` and `mergify` are small fakes that answer from files and log every call, and the
# remote is a bare repository on disk.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$ROOT/skills/create-pr/scripts/lib/draft-pr.sh"
STEP9="$ROOT/skills/create-pr/references/push-and-create.md"
PREFLIGHT="$ROOT/skills/create-pr/references/preflight.md"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

command -v jq >/dev/null 2>&1 || { echo "existing-pr-lookup: jq is required"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Isolate git from the host: no user or system config, no hooks, a fixed identity.
export HOME="$TMP/home" GIT_CONFIG_NOSYSTEM=1
mkdir -p "$HOME" "$TMP/bin" "$TMP/fake"
export FAKE="$TMP/fake"
export GIT_AUTHOR_NAME=Seat GIT_AUTHOR_EMAIL=seat@catalyst.test
export GIT_COMMITTER_NAME=Seat GIT_COMMITTER_EMAIL=seat@catalyst.test
git config --global init.defaultBranch main
unset CATALYST_WORKFLOW_GITHUB_TOKEN CATALYST_PUSH_REMOTE CATALYST_CONFIG_PATH

# gh: `pr view <n> --json state` prints $FAKE/state-<n> and fails when that file is absent.
# `pr list --head <branch>` prints $FAKE/branch-<branch with / as _>, or nothing. Every call is logged.
cat >"$TMP/bin/gh" <<'SH'
#!/bin/sh
echo "gh $*" >>"$FAKE/calls.log"
if [ "$1" = pr ] && [ "$2" = view ]; then
  [ -f "$FAKE/state-$3" ] || exit 1
  cat "$FAKE/state-$3"
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = list ] && [ "$3" = --head ]; then
  key="$(printf '%s' "$4" | tr '/' '_')"
  [ -f "$FAKE/branch-$key" ] && cat "$FAKE/branch-$key"
  exit 0
fi
exit 1
SH
# mergify: `stack list --json` prints $FAKE/stack.json, and fails when that file is absent.
cat >"$TMP/bin/mergify" <<'SH'
#!/bin/sh
echo "mergify $*" >>"$FAKE/calls.log"
[ "$1" = stack ] && [ "$2" = list ] && [ -f "$FAKE/stack.json" ] || exit 1
cat "$FAKE/stack.json"
SH
chmod +x "$TMP/bin/gh" "$TMP/bin/mergify"
export PATH="$TMP/bin:$PATH"

LOWER="I1111111111111111111111111111111111111111"
TOP="I2222222222222222222222222222222222222222"
STACK_BRANCH_SUFFIX="top-change--22222222"

# repo <name> <branch> [stack] — a bare remote and a seat clone on <branch>. With "stack", two
# commits that each carry a Change-Id trailer, the top one being HEAD. Nothing but main is pushed.
repo() {
  local d="$TMP/$1"
  git init -q --bare "$d/remote.git"
  git init -q "$d/seat"
  git -C "$d/seat" remote add origin "$d/remote.git"
  git -C "$d/seat" commit -q --allow-empty -m "chore: base"
  git -C "$d/seat" push -q origin main
  git -C "$d/seat" checkout -q -b "$2"
  if [[ "${3:-}" == stack ]]; then
    git -C "$d/seat" commit -q --allow-empty -m "feat: lower change" -m "Change-Id: $LOWER"
    git -C "$d/seat" commit -q --allow-empty -m "feat: top change" -m "Change-Id: $TOP"
  else
    git -C "$d/seat" commit -q --allow-empty -m "feat: plain change"
  fi
}

# stack_json <lower pull number or null> <top pull number or null>
stack_json() {
  printf '{"branch":"b","trunk":"origin/main","entries":[{"change_id":"%s","pull_number":%s},{"change_id":"%s","pull_number":%s}]}\n' \
    "$LOWER" "$1" "$TOP" "$2" >"$FAKE/stack.json"
}

reset_fakes() {
  rm -f "$FAKE"/calls.log "$FAKE"/stack.json "$FAKE"/state-* "$FAKE"/branch-*
  : >"$FAKE/calls.log"
}

lookup() { # lookup <dir> — runs the helper in a subshell; sets OUT, RC and ERR
  ERR="$TMP/err.$RANDOM"
  RC=0
  OUT="$(cd "$1" && source "$LIB" && draft_pr_stack_change_number 2>"$ERR")" || RC=$?
}

echo "── scenario 1: the top change of a stack has an open pull request"
repo s1 CTC-1 stack
reset_fakes
stack_json 9 10
echo OPEN >"$FAKE/state-9"
echo OPEN >"$FAKE/state-10"
lookup "$TMP/s1/seat"
check "the lookup returns 0 (rc=$RC)" "[[ $RC -eq 0 ]]"
check "it prints the top change's pull request, not the lower one's (got '$OUT')" "[[ '$OUT' == 10 ]]"
check "it asked the stack's own list" "grep -q '^mergify stack list --json' '$FAKE/calls.log'"
check "it did not look up by branch name" "! grep -q '^gh pr list' '$FAKE/calls.log'"
# Control: the lookup by branch name, which create-pr relied on before, finds nothing here.
check "control: a lookup by branch name finds nothing for this stack" "[[ -z \"\$(gh pr list --head CTC-1 --state open --json number -q '.[0].number // empty')\" ]]"

echo "── scenario 2: only a lower change has an open pull request"
repo s2 CTC-2 stack
reset_fakes
stack_json 9 null
echo OPEN >"$FAKE/state-9"
lookup "$TMP/s2/seat"
check "the lookup returns 0 (rc=$RC)" "[[ $RC -eq 0 ]]"
check "it prints nothing: the lower change's pull request is not this change's (got '$OUT')" "[[ -z '$OUT' ]]"
check "it never asked about the lower change's pull request" "! grep -q '^gh pr view 9' '$FAKE/calls.log'"

echo "── scenario 3: the only pull request for this change is closed"
repo s3 CTC-3 stack
reset_fakes
stack_json 9 10
echo CLOSED >"$FAKE/state-10"
lookup "$TMP/s3/seat"
check "the lookup returns 0 (rc=$RC)" "[[ $RC -eq 0 ]]"
check "it prints nothing for a closed pull request (got '$OUT')" "[[ -z '$OUT' ]]"

echo "── scenario 4: an ordinary branch is left to the caller"
repo s4 CTC-4
reset_fakes
echo 7 >"$FAKE/branch-CTC-4"
lookup "$TMP/s4/seat"
check "the lookup returns 0 (rc=$RC)" "[[ $RC -eq 0 ]]"
check "it prints nothing (got '$OUT')" "[[ -z '$OUT' ]]"
check "it asked neither the stack tool nor gh" "[[ ! -s '$FAKE/calls.log' ]]"

echo "── scenario 5: the stack list is unavailable, and the remote has the stack tool's branch"
repo s5 CTC-5 stack
reset_fakes
git -C "$TMP/s5/seat" push -q origin "HEAD:refs/heads/stack/seat/CTC-5/$STACK_BRANCH_SUFFIX"
echo 12 >"$FAKE/branch-stack_seat_CTC-5_$STACK_BRANCH_SUFFIX"
lookup "$TMP/s5/seat"
check "the lookup returns 0 (rc=$RC)" "[[ $RC -eq 0 ]]"
check "it prints the pull request found on the stack tool's branch (got '$OUT')" "[[ '$OUT' == 12 ]]"
check "it looked up that remote branch, not the local one" "grep -q '^gh pr list --head stack/seat/CTC-5/$STACK_BRANCH_SUFFIX ' '$FAKE/calls.log'"

echo "── scenario 6: the stack list does not hold this change, and the remote has no stack branch"
repo s6 CTC-6 stack
reset_fakes
printf '{"branch":"b","trunk":"origin/main","entries":[{"change_id":"%s","pull_number":9}]}\n' "$LOWER" >"$FAKE/stack.json"
lookup "$TMP/s6/seat"
check "the lookup returns 0 (rc=$RC)" "[[ $RC -eq 0 ]]"
check "it prints nothing: the remote answered, and there is no pull request (got '$OUT')" "[[ -z '$OUT' ]]"

echo "── scenario 7: neither the stack list nor the remote can answer"
repo s7 CTC-7 stack
reset_fakes
git -C "$TMP/s7/seat" remote set-url origin "$TMP/s7/gone.git"
lookup "$TMP/s7/seat"
check "the lookup returns the retriable code (rc=$RC)" "[[ $RC -eq 8 ]]"
check "it prints nothing (got '$OUT')" "[[ -z '$OUT' ]]"
check "it says no pull request was created" "grep -q 'No pull request was created' '$ERR'"

echo "── scenario 8: the stack lists a pull request whose state cannot be read"
repo s8 CTC-8 stack
reset_fakes
stack_json 9 10
lookup "$TMP/s8/seat"
check "the lookup returns the retriable code (rc=$RC)" "[[ $RC -eq 8 ]]"
check "it prints nothing (got '$OUT')" "[[ -z '$OUT' ]]"

echo "── scenario 9: two remote branches end in this change's suffix, and only the second has a pull request"
repo s9 CTC-9 stack
reset_fakes
# "CTC-9-old" sorts before "CTC-9", so the branch with no pull request is listed first.
git -C "$TMP/s9/seat" push -q origin "HEAD:refs/heads/stack/seat/CTC-9-old/$STACK_BRANCH_SUFFIX"
git -C "$TMP/s9/seat" push -q origin "HEAD:refs/heads/stack/seat/CTC-9/$STACK_BRANCH_SUFFIX"
echo 12 >"$FAKE/branch-stack_seat_CTC-9_$STACK_BRANCH_SUFFIX"
lookup "$TMP/s9/seat"
check "control: the branch with no pull request is the first one listed" "[[ \"\$(git -C '$TMP/s9/seat' ls-remote --heads origin '*--22222222' | head -1)\" == *CTC-9-old/* ]]"
check "the lookup returns 0 (rc=$RC)" "[[ $RC -eq 0 ]]"
check "it prints the pull request on the second branch (got '$OUT')" "[[ '$OUT' == 12 ]]"
check "it asked about both branches" "[[ \"\$(grep -c '^gh pr list --head stack/seat/CTC-9' '$FAKE/calls.log')\" == 2 ]]"

echo "── scenario 10: two remote branches for this change have different open pull requests"
repo s10 CTC-10 stack
reset_fakes
git -C "$TMP/s10/seat" push -q origin "HEAD:refs/heads/stack/seat/CTC-10-old/$STACK_BRANCH_SUFFIX"
git -C "$TMP/s10/seat" push -q origin "HEAD:refs/heads/stack/seat/CTC-10/$STACK_BRANCH_SUFFIX"
echo 11 >"$FAKE/branch-stack_seat_CTC-10-old_$STACK_BRANCH_SUFFIX"
echo 12 >"$FAKE/branch-stack_seat_CTC-10_$STACK_BRANCH_SUFFIX"
lookup "$TMP/s10/seat"
check "the lookup returns the retriable code (rc=$RC)" "[[ $RC -eq 8 ]]"
check "it prints nothing: it does not choose between them (got '$OUT')" "[[ -z '$OUT' ]]"
check "it names both pull requests" "grep -q '#11 and #12' '$ERR'"

echo "── create-pr looks before it creates"
LOOK_LINE="$(grep -n 'pr_number="\$(draft_pr_stack_change_number)"' "$STEP9" | head -1 | cut -d: -f1)"
STOP_LINE="$(grep -n 'exit "\$LOOKUP_RC"' "$STEP9" | head -1 | cut -d: -f1)"
CREATE_LINE="$(grep -n 'gh pr create --title' "$STEP9" | head -1 | cut -d: -f1)"
check "Step 9 calls the lookup" "[[ -n '$LOOK_LINE' ]]"
check "Step 9 still creates a pull request when there is none" "[[ -n '$CREATE_LINE' ]]"
check "Step 9 looks, then stops on a lookup it could not finish, then creates" "[[ -n '$LOOK_LINE' && -n '$STOP_LINE' && -n '$CREATE_LINE' && $LOOK_LINE -lt $STOP_LINE && $STOP_LINE -lt $CREATE_LINE ]]"
check "Step 10 is handed the number either way" "grep -q 'describe-pr. skill with .\$pr_number.' '$STEP9'"
check "the preflight's existing pull request check asks the stack first" "grep -q 'stack_pr=\"\$(draft_pr_stack_change_number)\"' '$PREFLIGHT'"
check "the preflight's describe action is handed the number it found" "grep -q 'describe-pr. skill with the .number. printed above' '$PREFLIGHT'"
check "the preflight keeps the lookup by branch name for an ordinary branch" "grep -q '^  gh pr view --json number,url,title,state 2>/dev/null' '$PREFLIGHT'"

echo ""
echo "existing-pr-lookup: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
