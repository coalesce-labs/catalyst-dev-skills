#!/usr/bin/env bash
# create-worktree-paths.test.sh — create-worktree follows the paths contract (CTC-3791).
#
# Run: bash tests/create-worktree-paths.test.sh
#
# Everything lives in a scratch dir outside any checkout: HOME, the thoughts repo, the worktrees
# root and two clones named "catalyst" whose origins name different owners. A humanlayer stub
# stands in for the CLI; thoughts come from the carried worktree-thoughts-init.sh.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CW="$REPO_ROOT/vendor-src/scripts/create-worktree.sh"
S="$(mktemp -d "${TMPDIR:-/tmp}/cw-paths.XXXXXX")"
trap 'rm -rf "$S"' EXIT
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1 — $2"; }

mkdir -p "$S/home/.config/humanlayer" "$S/bin" "$S/thoughts" "$S/src/coalesce-labs" "$S/src/ryanrozich"
printf '{"thoughts":{"thoughtsRepo":"%s","user":"t"}}\n' "$S/thoughts" > "$S/home/.config/humanlayer/humanlayer.json"
printf '#!/usr/bin/env bash\nexit 0\n' > "$S/bin/humanlayer"
chmod +x "$S/bin/humanlayer"
for owner in coalesce-labs ryanrozich; do
  git -C "$S/src/$owner" init -q -b main catalyst
  git -C "$S/src/$owner/catalyst" -c user.email=t@t.t -c user.name=t commit -q --allow-empty -m init
  git -C "$S/src/$owner/catalyst" remote add origin "git@github.com:$owner/catalyst.git"
done
A="$S/src/coalesce-labs/catalyst"
B="$S/src/ryanrozich/catalyst"

# cw <clone> <name> [env assignments…] [-- flags…] — create-worktree in <clone> with a clean env.
cw() {
  local clone="$1" name="$2"
  shift 2
  local -a envs=() flags=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do envs+=("$1"); shift; done
  [ "${1:-}" = "--" ] && shift
  flags=("$@")
  (cd "$clone" && env -i PATH="$S/bin:$PATH" HOME="$S/home" ${envs[@]+"${envs[@]}"} \
    bash "$CW" "$name" main --skip-fetch ${flags[@]+"${flags[@]}"}) > "$S/last.log" 2>&1
}
is_tree() { git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1; }

echo "create-worktree: paths contract (CTC-3791)"

cw "$A" CTC-1 CATALYST_WORKTREES_DIR="$S/wt"
is_tree "$S/wt/coalesce-labs.catalyst/CTC-1" && ok "CATALYST_WORKTREES_DIR roots the tree under <owner>.<repo>" \
  || fail "CATALYST_WORKTREES_DIR roots the tree under <owner>.<repo>" "$(tail -3 "$S/last.log")"

cw "$B" CTC-1 CATALYST_WORKTREES_DIR="$S/wt"
if is_tree "$S/wt/ryanrozich.catalyst/CTC-1" && is_tree "$S/wt/coalesce-labs.catalyst/CTC-1"; then
  ok "two clones named catalyst under different owners land in different folders"
else fail "two clones named catalyst under different owners land in different folders" "$(tail -3 "$S/last.log")"; fi

cat > "$S/paths.json" <<EOF
{"version":1,"paths":{"repoRoot":"$S/m/repos","worktrees":"$S/m/wt","logs":"$S/m/logs","events":"$S/m/events","config":"$S/m/config","cache":"$S/m/cache","state":"$S/m/state","skills":"$S/m/skills"},"provenance":{}}
EOF
cw "$A" CTC-2 CATALYST_PATHS_FILE="$S/paths.json"
is_tree "$S/m/wt/coalesce-labs.catalyst/CTC-2" && ok "paths.json names the root when the variable is unset" \
  || fail "paths.json names the root when the variable is unset" "$(tail -3 "$S/last.log")"

# An old-key tree of THIS repository is used where it is.
git -C "$A" worktree add -q -b CTC-3 "$S/wt/catalyst/CTC-3" main
cw "$A" CTC-3 CATALYST_WORKTREES_DIR="$S/wt" -- --reuse-existing
if [ ! -e "$S/wt/coalesce-labs.catalyst/CTC-3" ] && grep -qF "$S/wt/catalyst/CTC-3" "$S/last.log"; then
  ok "an existing old-key worktree of the same repository is reused, not duplicated"
else fail "an existing old-key worktree of the same repository is reused, not duplicated" "$(tail -3 "$S/last.log")"; fi

# An old-key tree of ANOTHER repository with the same name is never adopted.
git -C "$B" worktree add -q -b CTC-4 "$S/wt/catalyst/CTC-4" main
cw "$A" CTC-4 CATALYST_WORKTREES_DIR="$S/wt"
if is_tree "$S/wt/coalesce-labs.catalyst/CTC-4"; then
  ok "an old-key worktree that belongs to another clone is left alone"
else fail "an old-key worktree that belongs to another clone is left alone" "$(tail -3 "$S/last.log")"; fi

# Two clones of the SAME upstream share <owner>.<repo>: reuse never hands back the other clone's tree.
git clone -q "$A" "$S/src/second/catalyst" 2>/dev/null
git -C "$S/src/second/catalyst" remote set-url origin git@github.com:coalesce-labs/catalyst.git
cw "$S/src/second/catalyst" CTC-1 CATALYST_WORKTREES_DIR="$S/wt" -- --reuse-existing
rc=$?
if [ "$rc" -eq 64 ] && grep -q "belongs to another clone" "$S/last.log" \
  && [ "$(git -C "$S/wt/coalesce-labs.catalyst/CTC-1" rev-parse --path-format=absolute --git-common-dir)" = "$(cd "$A/.git" && pwd -P)" ]; then
  ok "a second clone of the same upstream is refused the first clone's tree, which is left alone"
else fail "a second clone of the same upstream is refused the first clone's tree, which is left alone" "rc=$rc $(tail -3 "$S/last.log")"; fi

# Clone A's own old-key tree wins even when the new-key path holds another clone's tree.
git -C "$A" worktree add -q -b CTC-12 "$S/wt/catalyst/CTC-12" main
git -C "$S/src/second/catalyst" worktree add -q -b CTC-12 "$S/wt/coalesce-labs.catalyst/CTC-12" main
cw "$A" CTC-12 CATALYST_WORKTREES_DIR="$S/wt" -- --reuse-existing
rc=$?
[ "$rc" -eq 0 ] && grep -qF "$S/wt/catalyst/CTC-12" "$S/last.log" && ok "a clone's own old-key tree is found before another clone's new-key tree is refused" \
  || fail "a clone's own old-key tree is found before another clone's new-key tree is refused" "rc=$rc $(tail -3 "$S/last.log")"

# A tree under the standard default root is still found after CATALYST_WORKTREES_DIR moves the root.
git -C "$A" worktree add -q -b CTC-11 "$S/ch/wt/catalyst/CTC-11" main
cw "$A" CTC-11 CATALYST_HOME="$S/ch" CATALYST_WORKTREES_DIR="$S/wt2" -- --reuse-existing
rc=$?
if [ "$rc" -eq 0 ] && grep -qF "$S/ch/wt/catalyst/CTC-11" "$S/last.log" && [ ! -e "$S/wt2/coalesce-labs.catalyst/CTC-11" ]; then
  ok "a tree under the old default root is reused after the root moves"
else fail "a tree under the old default root is reused after the root moves" "rc=$rc $(tail -3 "$S/last.log")"; fi

# CATALYST_HOME moved the default, but the old script ignored it: a tree under HOME's old default is found.
SH="$S/home"
git -C "$A" worktree add -q -b CTC-14 "$SH/catalyst/wt/catalyst/CTC-14" main
cw "$A" CTC-14 CATALYST_HOME="$S/ch" -- --reuse-existing
rc=$?
if [ "$rc" -eq 0 ] && grep -qF "$SH/catalyst/wt/catalyst/CTC-14" "$S/last.log"; then
  ok "a tree under the historical HOME default is reused when CATALYST_HOME is set"
else fail "a tree under the historical HOME default is reused when CATALYST_HOME is set" "rc=$rc $(tail -3 "$S/last.log")"; fi
git -C "$A" worktree remove --force "$SH/catalyst/wt/catalyst/CTC-14" && rm -rf "$SH/catalyst"

# A local-path origin names no owner: the key falls back to the repo name, as before.
git -C "$S/src" clone -q "$A" local-origin 2>/dev/null
git -C "$S/src/local-origin" remote set-url origin /srv/git/acme/app.git
cw "$S/src/local-origin" CTC-13 CATALYST_WORKTREES_DIR="$S/wt"
is_tree "$S/wt/local-origin/CTC-13" && [ ! -e "$S/wt/acme.app" ] && ok "a local-path origin keeps the no-owner key" \
  || fail "a local-path origin keeps the no-owner key" "$(ls "$S/wt")"

cw "$A" CTC-5 CATALYST_WORKTREES_DIR="$S/wt" -- --worktree-dir "$S/explicit"
is_tree "$S/explicit/CTC-5" && ok "--worktree-dir still wins" || fail "--worktree-dir still wins" "$(tail -3 "$S/last.log")"

if cw "$A" CTC-6 CATALYST_WORKTREES_DIR="relative/wt"; then
  fail "a relative CATALYST_WORKTREES_DIR refuses" "exit 0"
elif [ -e "$A/relative" ] || grep -q "Creating worktree" "$S/last.log"; then
  fail "a relative CATALYST_WORKTREES_DIR refuses" "something was created"
else ok "a relative CATALYST_WORKTREES_DIR refuses before creating anything"; fi

[ ! -e "$S/home/catalyst" ] && ok "nothing was written under \$HOME/catalyst" || fail "nothing was written under \$HOME/catalyst" "$(find "$S/home/catalyst" | head)"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
