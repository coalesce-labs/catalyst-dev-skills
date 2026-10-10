#!/usr/bin/env bash
# push-replay.test.sh — a rejected seat push keeps the commits the seat did not write (CTC-5513).
#
# Run: bash tests/push-replay.test.sh
#
# Branches are kept current while work is in flight: the upkeep robot merges main into a seat's
# branch. When the seat's push is then rejected, draft_pr_push_verify replays only the seat's
# unpublished commits onto the moved tip and pushes fast-forward. It never forces. A replay
# conflict pushes nothing and leaves the rebase in progress. A Mergify stack branch is never
# replayed: the local stack is authoritative. merge-pr brings a branch current with a merge
# commit, never a rebase or a force push.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$ROOT/skills/create-pr/scripts/lib/draft-pr.sh"
BEHIND_DOC="$ROOT/skills/merge-pr/references/ci-fixup-and-behind.md"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Isolate git from the host: no user or system config, no hooks, a fixed identity, and a gh that
# always fails so the helper falls back to "main" without a network call.
export HOME="$TMP/home" GIT_CONFIG_NOSYSTEM=1
mkdir -p "$HOME" "$TMP/bin"
printf '#!/bin/sh\nexit 1\n' >"$TMP/bin/gh"
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"
export GIT_AUTHOR_NAME=Seat GIT_AUTHOR_EMAIL=seat@catalyst.test
export GIT_COMMITTER_NAME=Seat GIT_COMMITTER_EMAIL=seat@catalyst.test
git config --global init.defaultBranch main
git config --global advice.detachedHead false
unset CATALYST_WORKFLOW_GITHUB_TOKEN CATALYST_PUSH_REMOTE CATALYST_CONFIG_PATH

commit() { # commit <dir> <file> <line> <subject> [trailer]
  printf '%s\n' "$3" >"$1/$2"
  git -C "$1" add "$2"
  if [[ -n "${5:-}" ]]; then
    git -C "$1" commit -q -m "$4" -m "$5"
  else
    git -C "$1" commit -q -m "$4"
  fi
}

# fixture <name> [trailer] — a bare remote; a seat clone on branch CTC-1 with one published
# commit; a robot clone that moved main and merged it into CTC-1 with a merge commit.
fixture() {
  local d="$TMP/$1"
  git init -q --bare "$d/remote.git"
  git clone -q "$d/remote.git" "$d/seat" 2>/dev/null
  commit "$d/seat" README.md base "chore: base"
  commit "$d/seat" shared.txt "line one" "chore: shared file"
  git -C "$d/seat" push -q origin main
  git -C "$d/seat" checkout -q -b CTC-1
  commit "$d/seat" seat-a.txt a "feat: CTC-1 — published work" "${2:-}"
  git -C "$d/seat" push -q -u origin CTC-1
  git clone -q "$d/remote.git" "$d/robot" 2>/dev/null
  commit "$d/robot" main-only.txt m "feat: main moves on"
  git -C "$d/robot" push -q origin main
  git -C "$d/robot" checkout -q CTC-1
  git -C "$d/robot" -c user.name=Robot -c user.email=robot@catalyst.test merge -q --no-ff --no-edit main
  git -C "$d/robot" push -q origin CTC-1
}

push_verify() { # push_verify <dir> — runs the helper in a subshell; sets RC and ERR
  ERR="$TMP/err.$RANDOM"
  RC=0
  (cd "$1" && source "$LIB" && draft_pr_push_verify >/dev/null 2>"$ERR") || RC=$?
}

remote_tip() { git -C "$1" ls-remote "$1/../remote.git" refs/heads/CTC-1 | cut -f1; }

echo "── the helper never forces"
check "draft-pr.sh has no forced push" "! grep -nE 'push[^\\n]*--force' '$LIB'"
check "draft-pr.sh replays with rebase --onto" "grep -q 'rebase --onto \"\$tip\" \"\$published\"' '$LIB'"

echo "── scenario 1: a rejected push replays the unpublished commit and keeps the robot merge"
fixture s1
D="$TMP/s1"
PUBLISHED_A="$(git -C "$D/seat" rev-parse HEAD)"
ROBOT_MERGE="$(remote_tip "$D/seat")"
commit "$D/seat" seat-b.txt b "feat: CTC-1 — unpublished work"
git -C "$D/seat" fetch -q origin
# Positive control: a plain push really is rejected as non-fast-forward in this state.
if git -C "$D/seat" push --dry-run origin HEAD:CTC-1 >/dev/null 2>&1; then
  bad "control: plain push of the seat branch is rejected"
else
  ok "control: plain push of the seat branch is rejected"
fi
push_verify "$D/seat"
TIP="$(remote_tip "$D/seat")"
check "push-verify succeeds (rc=$RC)" "[[ $RC -eq 0 ]]"
check "the helper reported the moved branch" "grep -q 'branch moved' '$ERR'"
check "remote tip equals local HEAD" "[[ '$TIP' == \"\$(git -C '$D/seat' rev-parse HEAD)\" ]]"
check "the robot merge commit is preserved" "git -C '$D/seat' merge-base --is-ancestor '$ROBOT_MERGE' '$TIP'"
check "the replayed commit sits directly on the robot merge" "[[ \"\$(git -C '$D/seat' rev-parse '$TIP^')\" == '$ROBOT_MERGE' ]]"
check "only the unpublished commit was replayed" "[[ \"\$(git -C '$D/seat' rev-list --count '$ROBOT_MERGE..$TIP')\" == 1 ]]"
check "the published commit keeps its SHA" "git -C '$D/seat' merge-base --is-ancestor '$PUBLISHED_A' '$TIP'"
check "the unpublished change reached the remote" "[[ \"\$(git -C '$D/seat' show '$TIP:seat-b.txt')\" == b ]]"

echo "── scenario 2: a replay conflict pushes nothing and leaves the rebase in progress"
fixture s2
D="$TMP/s2"
commit "$D/robot" shared.txt "robot edit" "fix: robot edits the shared line"
git -C "$D/robot" push -q origin CTC-1
BEFORE="$(remote_tip "$D/seat")"
commit "$D/seat" shared.txt "seat edit" "feat: CTC-1 — seat edits the shared line"
git -C "$D/seat" fetch -q origin
push_verify "$D/seat"
check "push-verify returns the replay-conflict code (rc=$RC)" "[[ $RC -eq 7 ]]"
check "nothing was pushed" "[[ \"\$(remote_tip '$D/seat')\" == '$BEFORE' ]]"
check "the report says the branch moved" "grep -q 'branch moved' '$ERR'"
check "the report names the conflicting file" "grep -q 'conflicts in: shared.txt' '$ERR'"
check "the rebase is left in progress" "[[ -d '$D/seat/.git/rebase-merge' ]]"
check "the working tree holds the conflict" "git -C '$D/seat' diff --name-only --diff-filter=U | grep -qx shared.txt"

echo "── scenario 3: merge-pr brings a branch current with a merge commit"
D="$TMP/s3"
git init -q --bare "$D/remote.git"
git clone -q "$D/remote.git" "$D/seat" 2>/dev/null
commit "$D/seat" README.md base "chore: base"
git -C "$D/seat" push -q origin main
git -C "$D/seat" checkout -q -b CTC-1
commit "$D/seat" seat-a.txt a "feat: CTC-1 — published work"
git -C "$D/seat" push -q -u origin CTC-1
PUBLISHED_A="$(git -C "$D/seat" rev-parse HEAD)"
git clone -q "$D/remote.git" "$D/other" 2>/dev/null
commit "$D/other" main-only.txt m "feat: main moves on"
git -C "$D/other" push -q origin main
MAIN_TIP="$(git -C "$D/other" rev-parse HEAD)"
# Run the BEHIND block exactly as merge-pr documents it.
SNIPPET="$(awk '/^## BEHIND/{s=1} s&&/^```bash$/{c=1;next} c&&/^```$/{exit} c{print}' "$BEHIND_DOC")"
check "the BEHIND section has a bash block" "[[ -n \"\$SNIPPET\" ]]"
check "the BEHIND block merges, never rebases" "printf '%s' \"\$SNIPPET\" | grep -q 'git merge' && ! printf '%s' \"\$SNIPPET\" | grep -qE 'rebase|--force'"
(cd "$D/seat" && BASE_BRANCH=main && eval "$SNIPPET") >/dev/null 2>&1
SRC=$?
TIP="$(git -C "$D/seat" ls-remote "$D/remote.git" refs/heads/CTC-1 | cut -f1)"
check "the BEHIND block runs cleanly (rc=$SRC)" "[[ $SRC -eq 0 ]]"
check "the branch tip is a merge commit" "[[ \"\$(git -C '$D/seat' rev-list --parents -n 1 '$TIP' | wc -w | tr -d ' ')\" == 3 ]]"
check "its first parent is the published commit, unrewritten" "[[ \"\$(git -C '$D/seat' rev-parse '$TIP^1')\" == '$PUBLISHED_A' ]]"
check "its second parent is the base tip" "[[ \"\$(git -C '$D/seat' rev-parse '$TIP^2')\" == '$MAIN_TIP' ]]"
for doc in "$ROOT"/skills/merge-pr/references/*.md "$ROOT"/skills/merge-pr/assets/references/merge-blocker-diagnosis.md "$ROOT"/vendor-src/references/merge-blocker-diagnosis.md; do
  name="${doc#"$ROOT"/}"
  check "$name runs no rebase onto the base and no force push" "! grep -nE '^[[:space:]]*[0-9.]*[[:space:]]*git( -c [^ ]+)* (rebase origin|push[^\`]*--force)' '$doc'"
done

echo "── scenario 4: a stack-managed branch is not replayed and not forced"
fixture s4 "Change-Id: I0123456789abcdef0123456789abcdef01234567"
D="$TMP/s4"
BEFORE="$(remote_tip "$D/seat")"
commit "$D/seat" seat-b.txt b "feat: CTC-1 — next stack commit" "Change-Id: Ifedcba9876543210fedcba9876543210fedcba98"
LOCAL_BEFORE="$(git -C "$D/seat" rev-parse HEAD)"
git -C "$D/seat" fetch -q origin
push_verify "$D/seat"
check "push-verify returns the stack code (rc=$RC)" "[[ $RC -eq 6 ]]"
check "nothing was pushed" "[[ \"\$(remote_tip '$D/seat')\" == '$BEFORE' ]]"
check "the local stack is untouched" "[[ \"\$(git -C '$D/seat' rev-parse HEAD)\" == '$LOCAL_BEFORE' ]]"
check "no rebase was started" "[[ ! -d '$D/seat/.git/rebase-merge' ]]"
check "the seat is told to resync its stack" "grep -q 'mergify stack sync' '$ERR'"

echo ""
echo "push-replay: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
