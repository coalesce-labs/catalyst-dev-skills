#!/usr/bin/env bash
# thoughts-location.test.sh — thoughts setup follows the paths contract (CTC-3792).
#
# Run: bash tests/thoughts-location.test.sh
#
# A scratch dir holds HOME, the HumanLayer config (HUMANLAYER_CONFIG), a source repo whose origin
# is coalesce-labs/catalyst, and thoughts repos: a declared one (a clone of a bare remote, so a
# handoff can really be pushed) and another one the HumanLayer config points at. No humanlayer CLI
# is on PATH unless a case adds the stub.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V="$REPO_ROOT/vendor-src/scripts"
S="$(mktemp -d "${TMPDIR:-/tmp}/thoughts-loc.XXXXXX")"
S="$(cd "$S" && pwd -P)"
trap 'rm -rf "$S"' EXIT
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1 — $2"; }
check() { if eval "$2"; then ok "$1"; else fail "$1" "${3:-}"; fi; }

mkdir -p "$S/home" "$S/bin" "$S/other-thoughts"
g() { git -c user.email=t@t.t -c user.name=t "$@"; }
g init -q --bare -b main "$S/remote.git"
g clone -q "$S/remote.git" "$S/declared" 2>/dev/null
g -C "$S/declared" commit -q --allow-empty -m init && g -C "$S/declared" push -q -u origin main
g init -q -b main "$S/src/catalyst"
g -C "$S/src/catalyst" commit -q --allow-empty -m init
g -C "$S/src/catalyst" remote add origin git@github.com:coalesce-labs/catalyst.git
printf '#!/usr/bin/env bash\nexit 0\n' > "$S/bin/humanlayer"
chmod +x "$S/bin/humanlayer"

hl_other() {
  printf '{"thoughts":{"thoughtsRepo":"%s","reposDir":"repos","globalDir":"global","user":"t","profiles":{"acme":{"thoughtsRepo":"%s"}},"repoMappings":{}}}\n' \
    "$S/other-thoughts" "$S/other-thoughts" > "$S/hl.json"
}
# run <env assignments…> -- <command> — a clean environment with scratch HOME and HumanLayer config.
run() {
  local -a envs=()
  while [ "$1" != "--" ]; do envs+=("$1"); shift; done
  shift
  env -i PATH="/usr/bin:/bin:/usr/sbin:/sbin:$(dirname "$(command -v jq)"):$(dirname "$(command -v git)")" HOME="$S/home" \
    HUMANLAYER_CONFIG="$S/hl.json" USER=t ${envs[@]+"${envs[@]}"} bash -c "$*"
}
LOC="source '$V/lib/thoughts-location.sh'"

echo "thoughts location (CTC-3792)"

check "the variable names the thoughts repo" \
  '[ "$(run CATALYST_THOUGHTS_REPO="$S/declared" -- "$LOC; catalyst_thoughts_repo coalesce-labs")" = "$S/declared" ]'
printf '{"version":1,"paths":{"repoRoot":"%s/rr","worktrees":"%s/wt","logs":"/l","events":"/e","config":"/c","cache":"/k","state":"/s","skills":"/sk","thoughtsRepo":"%s/declared"},"provenance":{}}\n' "$S" "$S" "$S" > "$S/paths.json"
check "paths.json names it when the variable is unset" \
  '[ "$(run CATALYST_PATHS_FILE="$S/paths.json" -- "$LOC; catalyst_thoughts_repo coalesce-labs")" = "$S/declared" ]'
mkdir -p "$S/rr/coalesce-labs" && g clone -q "$S/remote.git" "$S/rr/coalesce-labs/thoughts" 2>/dev/null
check "<repoRoot>/<owner>/thoughts is used when it is a checkout" \
  '[ "$(run CATALYST_REPO_ROOT="$S/rr" -- "$LOC; catalyst_thoughts_repo coalesce-labs")" = "$S/rr/coalesce-labs/thoughts" ]'
check "nothing declared prints nothing (HumanLayer config stays in charge)" \
  '[ -z "$(run CATALYST_REPO_ROOT="$S/rr" -- "$LOC; catalyst_thoughts_repo ryanrozich")" ]'
check "a declared path that is not a git checkout refuses" \
  '! run CATALYST_THOUGHTS_REPO="$S/not-a-checkout" -- "$LOC; catalyst_thoughts_repo x" 2>/dev/null && [ ! -e "$S/not-a-checkout" ]'
check "a relative variable refuses" \
  '! run CATALYST_THOUGHTS_REPO=rel -- "$LOC; catalyst_thoughts_repo x" 2>/dev/null'

rm -f "$S/hl.json"
check "with no HumanLayer config, a minimal one with a real default profile for the declared repo is written" \
  '[ "$(run -- "$LOC; catalyst_thoughts_profile $S/declared coalesce-labs" 2>/dev/null)" = catalyst-coalesce-labs ] && [ "$(jq -r .thoughts.thoughtsRepo "$S/hl.json")" = "$S/declared" ] && [ "$(jq -r .thoughts.defaultProfile "$S/hl.json")" = catalyst-coalesce-labs ] && [ "$(jq -r ".thoughts.profiles[\"catalyst-coalesce-labs\"].thoughtsRepo" "$S/hl.json")" = "$S/declared" ]'
hl_other
check "a profile already pointing at the repo is reused" \
  '[ "$(run -- "$LOC; catalyst_thoughts_profile $S/other-thoughts coalesce-labs acme" 2>/dev/null)" = acme ]'
check "a repo no profile points at gets a catalyst-<owner> profile" \
  '[ "$(run -- "$LOC; catalyst_thoughts_profile $S/declared coalesce-labs acme" 2>/dev/null)" = catalyst-coalesce-labs ] && [ "$(jq -r ".thoughts.profiles[\"catalyst-coalesce-labs\"].thoughtsRepo" "$S/hl.json")" = "$S/declared" ]'
printf '{"thoughts":{"thoughtsRepo":"%s","defaultProfile":"acme","user":"t","profiles":{"acme":{"thoughtsRepo":"%s"}},"repoMappings":{}}}\n' "$S/declared" "$S/other-thoughts" > "$S/hl2.json"
check "a top-level repo match whose default profile describes another repo still yields a profile for the declared repo" \
  '[ "$(HUMANLAYER_CONFIG="$S/hl2.json" run HUMANLAYER_CONFIG="$S/hl2.json" -- "$LOC; catalyst_thoughts_profile $S/declared coalesce-labs" 2>/dev/null)" = catalyst-coalesce-labs ]'
check "asking again finds that profile rather than adding another" \
  '[ "$(run -- "$LOC; catalyst_thoughts_profile $S/declared coalesce-labs" 2>/dev/null)" = catalyst-coalesce-labs ] && [ "$(jq ".thoughts.profiles | length" "$S/hl.json")" = 2 ]'

# create-worktree with no humanlayer CLI: the declared repo alone is enough for the layout.
hl_other
(cd "$S/src/catalyst" && run CATALYST_THOUGHTS_REPO="$S/declared" CATALYST_WORKTREES_DIR="$S/wt" -- \
  "bash '$V/create-worktree.sh' CTC-7 main --skip-fetch") > "$S/cw.log" 2>&1
WT="$S/wt/coalesce-labs/catalyst/CTC-7"
check "create-worktree lays thoughts/shared into the declared repo under the repo's directory" \
  '[ "$(cd "$WT/thoughts/shared" 2>/dev/null && pwd -P)" = "$S/declared/repos/catalyst/shared" ]' "$(tail -5 "$S/cw.log")"
check "create-worktree pointed HumanLayer at the declared repo with a profile and a repo mapping" \
  '[ "$(jq -r --arg k "$(cd "$WT" && pwd -P)" ".thoughts.repoMappings[\$k].repo" "$S/hl.json")" = catalyst ] && [ "$(jq -r --arg k "$(cd "$WT" && pwd -P)" ".thoughts.repoMappings[\$k].profile" "$S/hl.json")" = catalyst-coalesce-labs ]'

# catalyst-thoughts init-or-repair in a fresh linked worktree, no .catalyst/config.json.
g -C "$S/src/catalyst" worktree add -q -b CTC-8 "$S/wt8" main
(cd "$S/wt8" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' init-or-repair") > "$S/ct.log" 2>&1
check "catalyst-thoughts init-or-repair uses the declared repo and the origin's repo name, not the worktree's folder" \
  '[ "$(cd "$S/wt8/thoughts/shared" 2>/dev/null && pwd -P)" = "$S/declared/repos/catalyst/shared" ]' "$(tail -5 "$S/ct.log")"

# worktree-thoughts-init on its own honours the declared repo when no --profile is given.
g -C "$S/src/catalyst" worktree add -q -b CTC-9 "$S/wt9" main
(cd "$S/wt9" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/worktree-thoughts-init.sh' --directory catalyst") > "$S/wti.log" 2>&1
check "worktree-thoughts-init honours the declared repo" \
  '[ "$(cd "$S/wt9/thoughts/shared" 2>/dev/null && pwd -P)" = "$S/declared/repos/catalyst/shared" ]' "$(tail -5 "$S/wti.log")"

# Handoff durability: inside the declared repo and no humanlayer → git sync → synced.
mkdir -p "$S/declared/repos/catalyst/shared/handoffs/CTC-7"
echo handoff > "$S/declared/repos/catalyst/shared/handoffs/CTC-7/h.md"
# The scratch HOME has no git identity, and Linux git cannot guess one; the commit needs it.
GIT_ID="GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t.t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t.t"
v="$(cd "$WT" && run CATALYST_THOUGHTS_REPO="$S/declared" $GIT_ID -- \
  "source '$V/lib/handoff-durability.sh'; handoff_sync_and_classify '$S/declared/repos/catalyst/shared/handoffs/CTC-7/h.md'" 2>"$S/hd.err")"
check "a handoff in the declared repo is pushed with git when there is no humanlayer, and verifies as synced" \
  '[ "$v" = synced ] && g -C "$S/remote.git" cat-file -e main:repos/catalyst/shared/handoffs/CTC-7/h.md' "verdict=$v $(cat "$S/hd.err")"
# Unrelated uncommitted notes in the thoughts checkout do not block the handoff's own sync.
mkdir -p "$S/declared/repos/catalyst/shared/handoffs/CTC-7"
echo draft > "$S/declared/notes-in-progress.md"
g -C "$S/declared" add notes-in-progress.md 2>/dev/null; g -C "$S/declared" commit -q -m notes 2>/dev/null; g -C "$S/declared" push -q 2>/dev/null
echo "draft edited" > "$S/declared/notes-in-progress.md"
g clone -q "$S/remote.git" "$S/other-clone" 2>/dev/null && echo x > "$S/other-clone/elsewhere.md" && g -C "$S/other-clone" add elsewhere.md && g -C "$S/other-clone" commit -q -m elsewhere && g -C "$S/other-clone" push -q 2>/dev/null
echo handoff2 > "$S/declared/repos/catalyst/shared/handoffs/CTC-7/h2.md"
v="$(cd "$WT" && run CATALYST_THOUGHTS_REPO="$S/declared" $GIT_ID -- \
  "source '$V/lib/handoff-durability.sh'; handoff_sync_and_classify '$S/declared/repos/catalyst/shared/handoffs/CTC-7/h2.md'" 2>"$S/hd2.err")"
check "unrelated uncommitted notes in the thoughts checkout do not stop a handoff syncing, and survive it" \
  '[ "$v" = synced ] && [ "$(cat "$S/declared/notes-in-progress.md")" = "draft edited" ]' "verdict=$v $(cat "$S/hd2.err")"

echo stray > "$S/other-thoughts/h.md"
v="$(cd "$WT" && run CATALYST_THOUGHTS_REPO="$S/declared" PATH="$S/bin:/usr/bin:/bin" -- \
  "source '$V/lib/handoff-durability.sh'; handoff_sync_and_classify '$S/other-thoughts/h.md'" 2>/dev/null)"
check "a handoff outside the declared repo is never called durable" '[ "$v" = local-only:not-in-pushed-tree ]' "verdict=$v"

v="$(cd "$WT" && run CATALYST_THOUGHTS_REPO=relative/thoughts PATH="$S/bin:/usr/bin:/bin" -- \
  "source '$V/lib/handoff-durability.sh'; handoff_sync_and_classify '$S/declared/repos/catalyst/shared/handoffs/CTC-7/h.md'" 2>/dev/null)"
check "a refused paths config never lets a handoff be called synced, even with humanlayer present" '[ "$v" = local-only:sync-unavailable ]' "verdict=$v"

# A healthy link into the OLD repo is re-pointed, with no humanlayer CLI.
g -C "$S/src/catalyst" worktree add -q -b CTC-10 "$S/wt10" main
hl_other
(cd "$S/wt10" && run -- "bash '$V/worktree-thoughts-init.sh' --directory catalyst") >/dev/null 2>&1
before="$(cd "$S/wt10/thoughts/shared" 2>/dev/null && pwd -P)"
(cd "$S/wt10" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' init-or-repair") > "$S/ct10.log" 2>&1
check "init-or-repair re-points a healthy link into another repo at the declared one, without humanlayer" \
  '[ "$before" = "$S/other-thoughts/repos/catalyst/shared" ] && [ "$(cd "$S/wt10/thoughts/shared" && pwd -P)" = "$S/declared/repos/catalyst/shared" ]' "before=$before $(tail -3 "$S/ct10.log")"

# create-worktree --reuse-existing repairs a reused tree whose healthy link points at the old repo.
(cd "$WT" && run -- "bash '$V/worktree-thoughts-init.sh' --directory catalyst --profile acme") >/dev/null 2>&1
(cd "$S/src/catalyst" && run CATALYST_THOUGHTS_REPO="$S/declared" CATALYST_WORKTREES_DIR="$S/wt" -- \
  "bash '$V/create-worktree.sh' CTC-7 main --skip-fetch --reuse-existing") > "$S/cw-reuse.log" 2>&1
check "reusing a worktree whose thoughts point at another repo re-points them at the declared repo" \
  '[ "$(cd "$WT/thoughts/shared" && pwd -P)" = "$S/declared/repos/catalyst/shared" ]' "$(tail -4 "$S/cw-reuse.log")"

# A refused paths config is an error, never a plain local thoughts/shared directory.
g -C "$S/src/catalyst" worktree add -q -b CTC-14 "$S/wt14" main
(cd "$S/wt14" && run CATALYST_THOUGHTS_REPO=relative/thoughts -- "bash '$V/catalyst-thoughts.sh' init-or-repair") > "$S/ct14.log" 2>&1
rc=$?
check "init-or-repair with a refused paths config fails and creates nothing" \
  '[ "$rc" -ne 0 ] && [ ! -e "$S/wt14/thoughts" ]' "rc=$rc $(tail -2 "$S/ct14.log")"

# A link into the declared repo but ANOTHER project's directory is re-pointed.
(cd "$S/wt14" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/worktree-thoughts-init.sh' --directory someone-else") >/dev/null 2>&1
(cd "$S/wt14" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' init-or-repair") > "$S/ct14b.log" 2>&1
check "init-or-repair re-points a link to another project's directory in the declared repo" \
  '[ "$(cd "$S/wt14/thoughts/shared" && pwd -P)" = "$S/declared/repos/catalyst/shared" ]' "$(tail -3 "$S/ct14b.log")"

(cd "$S/src/catalyst" && run CATALYST_THOUGHTS_REPO=relative/thoughts CATALYST_WORKTREES_DIR="$S/wt" -- \
  "bash '$V/create-worktree.sh' CTC-7 main --skip-fetch --reuse-existing") > "$S/cw-reuse-bad.log" 2>&1
rc=$?
check "reuse with a refused paths config refuses instead of reporting success" '[ "$rc" -eq 2 ]' "rc=$rc $(tail -2 "$S/cw-reuse-bad.log")"

(cd "$WT" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/worktree-thoughts-init.sh' --directory someone-else") >/dev/null 2>&1
(cd "$S/src/catalyst" && run CATALYST_THOUGHTS_REPO="$S/declared" CATALYST_WORKTREES_DIR="$S/wt" -- \
  "bash '$V/create-worktree.sh' CTC-7 main --skip-fetch --reuse-existing") > "$S/cw-reuse2.log" 2>&1
check "reuse re-points a link to another project's directory in the declared repo" \
  '[ "$(cd "$WT/thoughts/shared" && pwd -P)" = "$S/declared/repos/catalyst/shared" ]' "$(tail -3 "$S/cw-reuse2.log")"

# check reports a link to the wrong place in the declared repo, with no humanlayer CLI.
(cd "$S/wt14" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/worktree-thoughts-init.sh' --directory someone-else") >/dev/null 2>&1
(cd "$S/wt14" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' check") > "$S/ck14.log" 2>&1
rc=$?
check "check fails on a link to another project's directory in the declared repo" '[ "$rc" -ne 0 ] && grep -q "not .*declared thoughts repo" "$S/ck14.log"' "rc=$rc $(tail -2 "$S/ck14.log")"
(cd "$S/wt14" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' init-or-repair") >/dev/null 2>&1
(cd "$S/wt14" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' check") > "$S/ck14b.log" 2>&1
rc=$?
check "control: check passes once the link is right" '[ "$rc" -eq 0 ]' "rc=$rc $(tail -3 "$S/ck14b.log")"

# Reuse re-points in place: worktree-local thoughts content is not moved aside.
mkdir -p "$WT/thoughts/searchable" && echo keep > "$WT/thoughts/searchable/local.md"
(cd "$WT" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/worktree-thoughts-init.sh' --directory someone-else") >/dev/null 2>&1
(cd "$S/src/catalyst" && run CATALYST_THOUGHTS_REPO="$S/declared" CATALYST_WORKTREES_DIR="$S/wt" -- \
  "bash '$V/create-worktree.sh' CTC-7 main --skip-fetch --reuse-existing") > "$S/cw-reuse3.log" 2>&1
check "reuse re-points a misdirected link in place and keeps worktree-local thoughts" \
  '[ "$(cd "$WT/thoughts/shared" && pwd -P)" = "$S/declared/repos/catalyst/shared" ] && [ -f "$WT/thoughts/searchable/local.md" ] && ! ls -d "$WT"/thoughts.orphaned-* >/dev/null 2>&1' "$(tail -3 "$S/cw-reuse3.log")"

# check never writes the HumanLayer config, even when no profile points at the declared repo yet.
hl_other
before="$(shasum "$S/hl.json")"
(cd "$S/wt14" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' check") >/dev/null 2>&1
check "check leaves the HumanLayer config untouched" '[ "$(shasum "$S/hl.json")" = "$before" ]'

# A directory named in .claude/config.json is the one reuse repairs to, and verifies.
mkdir -p "$S/src/catalyst/.claude" "$WT/.claude"
printf '{"catalyst":{"thoughts":{"directory":"custom-dir"}}}\n' | tee "$S/src/catalyst/.claude/config.json" > "$WT/.claude/config.json"
(cd "$WT" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/worktree-thoughts-init.sh' --directory someone-else") >/dev/null 2>&1
(cd "$S/src/catalyst" && run CATALYST_THOUGHTS_REPO="$S/declared" CATALYST_WORKTREES_DIR="$S/wt" -- \
  "bash '$V/create-worktree.sh' CTC-7 main --skip-fetch --reuse-existing") > "$S/cw-reuse4.log" 2>&1
rc=$?
check "reuse repairs to the directory .claude/config.json names, and verifies it" \
  '[ "$rc" -eq 0 ] && [ "$(cd "$WT/thoughts/shared" && pwd -P)" = "$S/declared/repos/custom-dir/shared" ]' "rc=$rc $(tail -3 "$S/cw-reuse4.log")"
rm -rf "$S/src/catalyst/.claude" "$WT/.claude"

# A symlinked project directory in the thoughts repo is still the right place, not drift.
g -C "$S/src/catalyst" worktree add -q -b CTC-15 "$S/wt15" main
mkdir -p "$S/declared/elsewhere/real-dir/shared" && ln -sfn "$S/declared/elsewhere/real-dir" "$S/declared/repos/catalyst-linked"
(cd "$S/wt15" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/worktree-thoughts-init.sh' --directory catalyst-linked") >/dev/null 2>&1
mkdir -p "$S/wt15/.catalyst" && printf '{"catalyst":{"thoughts":{"directory":"catalyst-linked"}}}\n' > "$S/wt15/.catalyst/config.json"
(cd "$S/wt15" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' check") > "$S/ck15.log" 2>&1
rc=$?
check "a symlinked project directory in the thoughts repo passes check" '[ "$rc" -eq 0 ]' "rc=$rc $(tail -2 "$S/ck15.log")"

# A refused thoughts path after the worktree exists rolls the new worktree back.
(cd "$S/src/catalyst" && run CATALYST_THOUGHTS_REPO="$S/no-such-checkout" CATALYST_WORKTREES_DIR="$S/wt" WT_GUARD_LSOF=/usr/bin/false -- \
  "bash '$V/create-worktree.sh' CTC-16 main --skip-fetch") > "$S/cw16.log" 2>&1
rc=$?
check "a thoughts-resolution failure rolls the new worktree back" \
  '[ "$rc" -ne 0 ] && [ ! -e "$S/wt/coalesce-labs/catalyst/CTC-16" ]' "rc=$rc $(tail -3 "$S/cw16.log")"

# init-or-repair fixes a stale global link too, even when shared is already right.
g -C "$S/src/catalyst" worktree add -q -b CTC-17 "$S/wt17" main
(cd "$S/wt17" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/worktree-thoughts-init.sh' --directory catalyst") >/dev/null 2>&1
ln -sfn "$S/other-thoughts" "$S/wt17/thoughts/global"
(cd "$S/wt17" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' init-or-repair") >/dev/null 2>&1
check "init-or-repair re-points a stale global link when shared is already right" \
  '[ "$(readlink "$S/wt17/thoughts/global")" = "$S/declared/global" ]' "global -> $(readlink "$S/wt17/thoughts/global")"

# Reuse judges the target by the reused tree's own config, not the main checkout's.
mkdir -p "$WT/.catalyst" && printf '{"catalyst":{"thoughts":{"directory":"branch-dir"}}}\n' > "$WT/.catalyst/config.json"
(cd "$WT" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/worktree-thoughts-init.sh' --directory someone-else") >/dev/null 2>&1
(cd "$S/src/catalyst" && run CATALYST_THOUGHTS_REPO="$S/declared" CATALYST_WORKTREES_DIR="$S/wt" -- \
  "bash '$V/create-worktree.sh' CTC-7 main --skip-fetch --reuse-existing") > "$S/cw-reuse5.log" 2>&1
rc=$?
check "reuse repairs to, and accepts, the directory the reused tree's own config names" \
  '[ "$rc" -eq 0 ] && [ "$(cd "$WT/thoughts/shared" && pwd -P)" = "$S/declared/repos/branch-dir/shared" ]' "rc=$rc $(tail -3 "$S/cw-reuse5.log")"
rm -rf "$WT/.catalyst"

# A right-looking link with a stale HumanLayer mapping: check reports it, reuse repairs it.
g -C "$S/src/catalyst" worktree add -q -b CTC-18 "$S/wt18" main
(cd "$S/wt18" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/worktree-thoughts-init.sh' --directory catalyst") >/dev/null 2>&1
jq --arg k "$(cd "$S/wt18" && pwd -P)" '.thoughts.repoMappings[$k].profile = "acme"' "$S/hl.json" > "$S/hl.tmp" && mv "$S/hl.tmp" "$S/hl.json"
(cd "$S/wt18" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' check") > "$S/ck18.log" 2>&1
rc=$?
check "check reports a mapping to another repo even when the link is right" '[ "$rc" -ne 0 ] && grep -q "mapping" "$S/ck18.log"' "rc=$rc $(tail -2 "$S/ck18.log")"
jq --arg k "$(cd "$WT" && pwd -P)" '.thoughts.repoMappings[$k].profile = "acme"' "$S/hl.json" > "$S/hl.tmp" && mv "$S/hl.tmp" "$S/hl.json"
(cd "$S/src/catalyst" && run CATALYST_THOUGHTS_REPO="$S/declared" CATALYST_WORKTREES_DIR="$S/wt" -- \
  "bash '$V/create-worktree.sh' CTC-7 main --skip-fetch --reuse-existing") > "$S/cw-reuse6.log" 2>&1
check "reuse rewrites a stale HumanLayer mapping" \
  '[ "$(jq -r --arg k "$(cd "$WT" && pwd -P)" ".thoughts.repoMappings[\$k].profile" "$S/hl.json")" = catalyst-coalesce-labs ]' "$(tail -3 "$S/cw-reuse6.log")"

# check reports a mapping to another project directory, and a global link into another repo.
g -C "$S/src/catalyst" worktree add -q -b CTC-19 "$S/wt19" main
(cd "$S/wt19" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' init-or-repair") >/dev/null 2>&1
(cd "$S/wt19" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' check") > "$S/ck19a.log" 2>&1
rc=$?
check "control: check passes on a fresh declared layout" '[ "$rc" -eq 0 ]' "rc=$rc $(tail -3 "$S/ck19a.log")"
jq --arg k "$(cd "$S/wt19" && pwd -P)" '.thoughts.repoMappings[$k].repo = "someone-else"' "$S/hl.json" > "$S/hl.tmp" && mv "$S/hl.tmp" "$S/hl.json"
(cd "$S/wt19" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' check") > "$S/ck19b.log" 2>&1
check "check reports a mapping to another project directory" 'grep -q "names project directory" "$S/ck19b.log"' "$(tail -2 "$S/ck19b.log")"
ln -sfn "$S/other-thoughts" "$S/wt19/thoughts/global"
(cd "$S/wt19" && run CATALYST_THOUGHTS_REPO="$S/declared" -- "bash '$V/catalyst-thoughts.sh' check") > "$S/ck19c.log" 2>&1
check "check reports a global link into another repo" 'grep -q "thoughts/global resolves" "$S/ck19c.log"' "$(tail -2 "$S/ck19c.log")"

[ ! -e "$S/home/catalyst" ] && ok "nothing was written under \$HOME/catalyst" || fail "nothing was written under \$HOME/catalyst" "$(find "$S/home/catalyst" | head)"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
