#!/usr/bin/env bash
# prune-worktrees.test.sh — CTC-2550. The shape half (frontmatter, references, fail-closed
# invariants a static grep can prove) and the behaviour half (a real git fixture farm).
#
# Run: bash tests/prune-worktrees.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SKILL_DIR="${REPO_ROOT}/skills/prune-worktrees"

PASS=0
FAIL=0
ok()   { PASS=$((PASS+1)); printf '  PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  FAIL: %s\n    %s\n' "$1" "${2:-}"; }

[ -f "${SKILL_DIR}/SKILL.md" ] || { echo "FATAL: subject not found: skills/prune-worktrees/SKILL.md" >&2; exit 1; }

echo "prune-worktrees (CTC-2550)"

# ── 1. Frontmatter shape ─────────────────────────────────────────────────────────────────────
echo ""
echo "Shape"
if [ "$(sed -n '2p' "${SKILL_DIR}/SKILL.md")" = "name: prune-worktrees" ]; then
  ok "SKILL.md frontmatter name matches the directory"
else
  fail "SKILL.md frontmatter name matches the directory" "line 2: $(sed -n '2p' "${SKILL_DIR}/SKILL.md")"
fi
for f in version allowed-tools description disable-model-invocation; do
  grep -qE "^${f}:" "${SKILL_DIR}/SKILL.md" && ok "SKILL.md declares ${f}" || fail "SKILL.md declares ${f}"
done

# every references/*.md is linked from SKILL.md
for ref in "${SKILL_DIR}"/references/*.md; do
  name="$(basename "$ref")"
  if grep -qF "references/${name}" "${SKILL_DIR}/SKILL.md"; then
    ok "SKILL.md links references/${name}"
  else
    fail "SKILL.md links references/${name}"
  fi
done

# ── 2. FAIL-CLOSED INVARIANTS (static, grep-provable) ────────────────────────────────────────
echo ""
echo "Fail-closed invariants"

# 2a. no --force/-f on git worktree remove, anywhere in scripts/ (comments describing the
# invariant, like the guard's own header, are not invocations — exclude comment lines)
force_hits="$(grep -RnE 'git[^"'"'"'\n]*worktree remove[^\n]*(--force|[[:space:]]-f([[:space:]]|$))' "${SKILL_DIR}/scripts" | grep -vE ':[0-9]+:[[:space:]]*#')"
if [ -n "$force_hits" ]; then
  fail "no --force/-f on any 'git worktree remove' in scripts/" "$force_hits"
else
  ok "no --force/-f on any 'git worktree remove' in scripts/"
fi
# positive control: a planted violation IS reported by the same grep
tmp_violation="$(mktemp)"
printf 'git worktree remove --force "$x"\n' > "$tmp_violation"
if grep -nE 'git[^"'"'"'\n]*worktree remove[^\n]*(--force|[[:space:]]-f([[:space:]]|$))' "$tmp_violation" >/dev/null; then
  ok "control: a planted 'git worktree remove --force' line IS reported"
else
  fail "control: a planted 'git worktree remove --force' line IS reported"
fi
rm -f "$tmp_violation"

# 2b. no branch/ref/tag/reflog/gc destructive commands, and no rm -rf outside the log dir
DANGEROUS='git branch -D|git branch -d|git update-ref -d|git push --delete|git tag -d|git reflog expire|git gc --prune'
if grep -RnE "$DANGEROUS" "${SKILL_DIR}/scripts" >/dev/null; then
  fail "no branch/ref/tag/reflog/gc destructive commands in scripts/" "$(grep -RnE "$DANGEROUS" "${SKILL_DIR}/scripts")"
else
  ok "no branch/ref/tag/reflog/gc destructive commands in scripts/"
fi
tmp_violation2="$(mktemp)"
printf 'git branch -D "$b"\ngit update-ref -d refs/heads/x\ngit reflog expire --all\n' > "$tmp_violation2"
if grep -cE "$DANGEROUS" "$tmp_violation2" | grep -qv '^0$'; then
  ok "control: planted destructive-command lines ARE reported"
else
  fail "control: planted destructive-command lines ARE reported"
fi
rm -f "$tmp_violation2"

# 2c. SKILL.md states the asymmetry
if grep -qiE 'fail.closed' "${SKILL_DIR}/SKILL.md" \
  && grep -qiF 'worse than a full disk' "${SKILL_DIR}/references/fail-closed.md" \
  && grep -qiE 'ambiguous' "${SKILL_DIR}/SKILL.md"; then
  ok "SKILL.md and fail-closed.md state the fail-closed asymmetry"
else
  fail "SKILL.md and fail-closed.md state the fail-closed asymmetry"
fi

# 2d. references/fail-closed.md names every KEEP/REMOVE reason string the script can emit
reasons_in_script="$(grep -oE '"(dirty|locked|prunable|detached|content-not-in:\$\{def\}|merged:ancestor-of-\$\{def\}|within-retention-window:\$\{RETENTION_DAYS\}d|no-commits-beyond-base|unpushed-commits|no-merge-base|unsupported-farm-depth|no-primary-checkout|not-a-registered-worktree|refs-stale:fetch-failed|default-branch-unresolved|cwd-containment|liveness-unprovable|live-handles|removal-refused-by-git|hook-unusable:crashed|hook-unusable:unparseable|hook-upgrade-ignored)"' "${SKILL_DIR}/scripts/prune-worktrees.sh" | tr -d '"' | sort -u)"
missing=""
for r in $reasons_in_script; do
  case "$r" in
    "content-not-in:"*) r="content-not-in" ;;
    "merged:ancestor-of-"*) r="merged:ancestor-of" ;;
    "within-retention-window:"*) r="within-retention-window" ;;
  esac
  grep -qF "$r" "${SKILL_DIR}/references/fail-closed.md" || missing="${missing} ${r}"
done
if [ -z "$missing" ]; then
  ok "references/fail-closed.md documents every KEEP/REMOVE reason the script can emit"
else
  fail "references/fail-closed.md documents every KEEP/REMOVE reason the script can emit" "missing:${missing}"
fi

# 2e. vendored files are dependency-free (no sibling 'source' lines)
if grep -nE '^\s*(source|\.)\s' "${SKILL_DIR}/scripts/lib/worktree-remove-guard.sh" "${SKILL_DIR}/scripts/lib/plugin-dirs.sh" >/dev/null; then
  fail "vendored libs have no sibling source lines"
else
  ok "vendored libs have no sibling source lines"
fi

# ── 3. Behaviour: a real git fixture farm ────────────────────────────────────────────────────
echo ""
echo "Behaviour (real git fixture)"

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

LSOF_STUB="${SCRATCH}/bin/lsof-no-holders"
mkdir -p "${SCRATCH}/bin"
cat > "$LSOF_STUB" <<'EOS'
#!/usr/bin/env bash
exit 1
EOS
chmod +x "$LSOF_STUB"

build_farm_fixture() {
  # build_farm_fixture <dir> — a bare origin, a primary clone, and a farm at <dir>/wt/repo/*
  # with: CTC-A (merged, 2nd merge landed after), CTC-B (dirty, unmerged), CTC-C (locked),
  # CTC-D (prunable), CTC-E (merged), CTC-F (detached), CTC-G (merged, depth-1 under farm root),
  # CTC-H (merged, remote branch kept — repo has no auto-delete), CTC-I (merged + 1 unpushed
  # commit), CTC-J (net-zero: add then revert), CTC-K (merged, default branch later touched the
  # same file).
  local base="$1"
  mkdir -p "$base"
  git init -q --bare "${base}/origin.git"
  git init -q -b main "${base}/src"
  ( cd "${base}/src" && git config user.email t@t.t && git config user.name t \
      && git commit -q --allow-empty -m init \
      && git remote add origin "${base}/origin.git" && git push -q origin main )
  git -C "${base}/origin.git" symbolic-ref HEAD refs/heads/main
  git clone -q "${base}/origin.git" "${base}/primary"
  ( cd "${base}/primary" && git config user.email t@t.t && git config user.name t && git remote set-head origin -a )

  mkdir -p "${base}/wt/repo"

  mk_branch() { # mk_branch <name> <files-cmd>
    git -C "${base}/primary" worktree add -q -b "$1" "${base}/wt/repo/$1" origin/main
    ( cd "${base}/wt/repo/$1" && git config user.email t@t.t && git config user.name t && eval "$2" )
  }
  squash_merge() { # squash_merge <name>
    ( cd "${base}/primary" && git checkout -q -B main origin/main 2>/dev/null || git checkout -q main
      git pull -q origin main
      git merge --squash "$1" -q && git commit -q -m "squash $1" && git push -q origin main )
  }

  mk_branch CTC-A 'echo a1 > a1.txt; git add a1.txt; git commit -q -m a1; echo a2 > a2.txt; git add a2.txt; git commit -q -m a2'
  squash_merge CTC-A

  mk_branch CTC-E 'echo e1 > e1.txt; git add e1.txt; git commit -q -m e1'
  squash_merge CTC-E

  mk_branch CTC-B 'echo b1 > b1.txt; git add b1.txt; git commit -q -m b1; git push -q origin CTC-B'
  echo dirty >> "${base}/wt/repo/CTC-B/b1.txt"

  mk_branch CTC-C 'echo c1 > c1.txt; git add c1.txt; git commit -q -m c1'
  git -C "${base}/primary" worktree lock "${base}/wt/repo/CTC-C"

  git -C "${base}/primary" worktree add -q -b CTC-D "${base}/wt/repo/CTC-D" origin/main
  rm -rf "${base}/wt/repo/CTC-D"

  git -C "${base}/primary" worktree add -q --detach "${base}/wt/repo/CTC-F" origin/main

  git -C "${base}/primary" worktree add -q -b CTC-G "${base}/wt/CTC-G" origin/main
  ( cd "${base}/wt/CTC-G" && git config user.email t@t.t && git config user.name t && echo g1 > g1.txt && git add g1.txt && git commit -q -m g1 )
  squash_merge CTC-G

  # CTC-H: merged, but the remote branch is NOT deleted (repo has no auto-delete) — still REMOVE-eligible
  mk_branch CTC-H 'echo h1 > h1.txt; git add h1.txt; git commit -q -m h1; git push -q origin CTC-H'
  squash_merge CTC-H

  # CTC-I: merged upstream, plus one extra unpushed commit — KEEP
  mk_branch CTC-I 'echo i1 > i1.txt; git add i1.txt; git commit -q -m i1; git push -q origin CTC-I'
  squash_merge CTC-I
  ( cd "${base}/wt/repo/CTC-I" && echo i2 > i2.txt && git add i2.txt && git commit -q -m i2-unpushed )

  # CTC-J: net-zero (add then revert within the branch) — KEEP/no-commits-beyond-base
  mk_branch CTC-J 'echo j1 > j1.txt; git add j1.txt; git commit -q -m j1-add; git rm -q j1.txt; git commit -q -m j1-revert'

  # CTC-K: merged, but default branch LATER modifies the same file — KEEP/content-not-in
  mk_branch CTC-K 'echo k1 > k1.txt; git add k1.txt; git commit -q -m k1'
  squash_merge CTC-K
  ( cd "${base}/primary" && git checkout -q main && git pull -q origin main && echo k1-changed > k1.txt && git add k1.txt && git commit -q -m "main touches k1" && git push -q origin main )

  ( cd "${base}/wt/repo/CTC-A" && git fetch -q origin ) || true
}

BASE="${SCRATCH}/farm"
build_farm_fixture "$BASE"

run_prune() {
  # run_prune <mode> — sets env and runs the script; result on stdout
  CATALYST_WORKTREES_DIR="${BASE}/wt" \
  CATALYST_LOGS_DIR="${SCRATCH}/logs" \
  CATALYST_WORKTREE_STALE_DAYS=0 \
  CATALYST_PRUNE_ACTOR="tester@testhost" \
  WT_GUARD_LSOF="$LSOF_STUB" \
  bash "${SKILL_DIR}/scripts/prune-worktrees.sh" "$@"
}

latest_log() { ls -t "${SCRATCH}/logs/prune-worktrees"/*.jsonl 2>/dev/null | head -1; }

# ── classification (dry run) ─────────────────────────────────────────────────────────────────
out="$(run_prune --dry-run --json 2>&1)"
LOG1="$(latest_log)"

verdict_of() { printf '%s\n' "$out" | grep "\"path\":\"${BASE}/wt/repo/$1\"" | grep -oE '"verdict":"[A-Z]+"' | head -1; }
reason_of()  { printf '%s\n' "$out" | grep "\"path\":\"${BASE}/wt/repo/$1\"" | grep -oE '"reason":"[^"]*"' | head -1; }

[ "$(verdict_of CTC-A)" = '"verdict":"REMOVE"' ] && ok "CTC-A (merged, 2nd merge landed after): REMOVE" || fail "CTC-A: REMOVE" "$(verdict_of CTC-A) $(reason_of CTC-A)"
[ "$(verdict_of CTC-H)" = '"verdict":"REMOVE"' ] && ok "CTC-H (merged, remote branch kept): REMOVE" || fail "CTC-H: REMOVE" "$(verdict_of CTC-H) $(reason_of CTC-H)"
[ "$(verdict_of CTC-E)" = '"verdict":"REMOVE"' ] && ok "CTC-E (merged): REMOVE" || fail "CTC-E: REMOVE" "$(verdict_of CTC-E) $(reason_of CTC-E)"

remove_count="$(printf '%s\n' "$out" | grep -c '"verdict":"REMOVE"')"
[ "$remove_count" = 3 ] && ok "exactly three candidates verdict REMOVE (CTC-A, CTC-E, CTC-H)" || fail "exactly three candidates verdict REMOVE" "got ${remove_count}"

[ "$(reason_of CTC-B)" = '"reason":"dirty"' ] && ok "CTC-B: KEEP/dirty" || fail "CTC-B: KEEP/dirty" "$(reason_of CTC-B)"
[ "$(reason_of CTC-C)" = '"reason":"locked"' ] && ok "CTC-C: KEEP/locked" || fail "CTC-C: KEEP/locked" "$(reason_of CTC-C)"
[ "$(reason_of CTC-D)" = '"reason":"prunable"' ] && ok "CTC-D: KEEP/prunable (the union-enumeration case)" || fail "CTC-D: KEEP/prunable" "$(reason_of CTC-D)"
[ "$(reason_of CTC-F)" = '"reason":"detached"' ] && ok "CTC-F: KEEP/detached" || fail "CTC-F: KEEP/detached" "$(reason_of CTC-F)"
gline="$(printf '%s\n' "$out" | grep "\"path\":\"${BASE}/wt/CTC-G\"")"
printf '%s' "$gline" | grep -qF '"reason":"unsupported-farm-depth:1"' && ok "CTC-G (depth 1): KEEP/unsupported-farm-depth:1" || fail "CTC-G: KEEP/unsupported-farm-depth:1" "$gline"
# CTC-I's extra unpushed commit touches its own file, so the path-scoped equality check (which
# runs before the "nothing unpushed" check) already fails on that path — either reason string is
# a correct KEEP; what matters is it is never REMOVE.
ctc_i_verdict="$(verdict_of CTC-I)"
ctc_i_reason="$(reason_of CTC-I)"
if [ "$ctc_i_verdict" = '"verdict":"KEEP"' ]; then
  ok "CTC-I (extra unpushed commit): KEEP (${ctc_i_reason})"
else
  fail "CTC-I (extra unpushed commit): KEEP" "${ctc_i_verdict} ${ctc_i_reason}"
fi
[ "$(reason_of CTC-J)" = '"reason":"no-commits-beyond-base"' ] && ok "CTC-J (net-zero branch): KEEP/no-commits-beyond-base" || fail "CTC-J: KEEP/no-commits-beyond-base" "$(reason_of CTC-J)"
[ "$(reason_of CTC-K)" = '"reason":"content-not-in:origin/main"' ] && ok "CTC-K (default branch later touched the file): KEEP/content-not-in" || fail "CTC-K: KEEP/content-not-in" "$(reason_of CTC-K)"

# oracle positive control: whole-tree equality would wrongly refuse CTC-A on this fixture
if git -C "${BASE}/primary" diff --quiet origin/main refs/heads/CTC-A 2>/dev/null; then
  fail "control: whole-tree equality is wrong on this fixture" "expected non-zero (not tree-equal)"
else
  ok "control: whole-tree diff --quiet on CTC-A is non-zero — the fixture separates the two oracles"
fi

# the log: every line parses, every record carries the required fields, a summary closes it
if [ -n "$LOG1" ] && while IFS= read -r l; do [ -n "$l" ] || continue; printf '%s' "$l" | jq -e . >/dev/null || exit 1; done < "$LOG1"; then
  ok "every log line parses as JSON"
else
  fail "every log line parses as JSON" "$LOG1"
fi
if [ -n "$LOG1" ] && grep -q '"kind":"summary"' "$LOG1" && tail -1 "$LOG1" | grep -q '"kind":"summary"'; then
  ok "the log ends with a summary record"
else
  fail "the log ends with a summary record"
fi
if [ -n "$LOG1" ] && head -1 "$LOG1" | jq -e 'has("ts") and has("host") and has("actor") and has("repo") and has("path") and has("branch") and has("verdict") and has("reason") and has("head")' >/dev/null 2>&1; then
  ok "a candidate record carries every required field"
else
  fail "a candidate record carries every required field" "$(head -1 "$LOG1")"
fi

# a run that removes nothing STILL writes a log and a summary (Gherkin scenario 2)
EMPTYBASE="${SCRATCH}/empty-farm"
mkdir -p "${EMPTYBASE}"
EMPTYLOGS="${SCRATCH}/empty-logs"
CATALYST_WORKTREES_DIR="${EMPTYBASE}" CATALYST_LOGS_DIR="$EMPTYLOGS" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run >/dev/null
if ls "${EMPTYLOGS}/prune-worktrees"/*.jsonl >/dev/null 2>&1 && grep -q '"kind":"summary"' "${EMPTYLOGS}/prune-worktrees"/*.jsonl; then
  ok "an empty farm still writes a log and a summary record"
else
  fail "an empty farm still writes a log and a summary record"
fi

# ── refusals that refuse a whole repository ──────────────────────────────────────────────────
FETCHBASE="${SCRATCH}/fetch-fail"
mkdir -p "${FETCHBASE}/wt/repo"
git init -q -b main "${FETCHBASE}/primaryonly"
( cd "${FETCHBASE}/primaryonly" && git config user.email t@t.t && git config user.name t && git commit -q --allow-empty -m init && git remote add origin /tmp/does-not-exist-prune-wt-test.git )
git -C "${FETCHBASE}/primaryonly" worktree add -q -b FF-A "${FETCHBASE}/wt/repo/FF-A" main
out2="$(CATALYST_WORKTREES_DIR="${FETCHBASE}/wt" CATALYST_LOGS_DIR="${SCRATCH}/logs-fetch" CATALYST_REPO_ROOT="${FETCHBASE}" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run --json 2>&1)"
if printf '%s' "$out2" | grep -q '"reason":"refs-stale:fetch-failed"'; then
  ok "a fetch failure refuses the whole repository (refs-stale:fetch-failed)"
else
  fail "a fetch failure refuses the whole repository" "$out2"
fi

NODEFAULTBASE="${SCRATCH}/no-default"
mkdir -p "${NODEFAULTBASE}/wt/repo"
git init -q --bare "${NODEFAULTBASE}/bare-origin.git"
git init -q -b unmapped "${NODEFAULTBASE}/primary"
# no refs/heads/main|master|trunk anywhere, and the bare repo's own HEAD is never pointed at
# "unmapped" — so symbolic-ref, remote set-head -a, and the main/master/trunk fallback all fail.
( cd "${NODEFAULTBASE}/primary" && git config user.email t@t.t && git config user.name t && git commit -q --allow-empty -m init && git remote add origin "${NODEFAULTBASE}/bare-origin.git" && git push -q origin unmapped )
git -C "${NODEFAULTBASE}/primary" worktree add -q -b ND-A "${NODEFAULTBASE}/wt/repo/ND-A" unmapped
out3="$(CATALYST_WORKTREES_DIR="${NODEFAULTBASE}/wt" CATALYST_LOGS_DIR="${SCRATCH}/logs-nodefault" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run --json 2>&1)"
if printf '%s' "$out3" | grep -q '"reason":"default-branch-unresolved"'; then
  ok "no resolvable default branch refuses the whole repository (default-branch-unresolved)"
else
  fail "no resolvable default branch refuses the whole repository" "$out3"
fi

# ── refusals that refuse the whole run ───────────────────────────────────────────────────────
out4="$(CATALYST_PROFILE=container CATALYST_WORKTREES_DIR= CATALYST_WORK_TREES= env -u CATALYST_WORKTREES_DIR -u CATALYST_WORK_TREES bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run 2>&1)"
rc4=$?
if [ "$rc4" -eq 3 ] && printf '%s' "$out4" | grep -qF 'CATALYST_WORKTREES_DIR'; then
  ok "CATALYST_PROFILE=container with no farm variable set: exit 3, names CATALYST_WORKTREES_DIR"
else
  fail "profile refusal names the variable and exits 3" "rc=$rc4 out=$out4"
fi

out5="$(CATALYST_WORKTREES_DIR="${BASE}/wt" CATALYST_LOGS_DIR="${SCRATCH}/logs-hook" CATALYST_WT_CLASSIFIER=/does/not/exist bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run 2>&1)"
rc5=$?
[ "$rc5" -eq 3 ] && ok "a non-executable CATALYST_WT_CLASSIFIER refuses the run (exit 3)" || fail "non-executable classifier refuses" "rc=$rc5"

# ── the variable contract ────────────────────────────────────────────────────────────────────
outv1="$(CATALYST_WORKTREES_DIR="${BASE}/wt" CATALYST_LOGS_DIR="${SCRATCH}/logs-v1" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run 2>&1)"
printf '%s' "$outv1" | grep -q 'scanned=1[01]' && ok "CATALYST_WORKTREES_DIR alone resolves the farm" || fail "CATALYST_WORKTREES_DIR alone resolves the farm" "$outv1"
outv2="$(env -u CATALYST_WORKTREES_DIR CATALYST_WORK_TREES="${BASE}/wt" CATALYST_LOGS_DIR="${SCRATCH}/logs-v2" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run 2>&1)"
printf '%s' "$outv2" | grep -q 'scanned=1[01]' && ok "CATALYST_WORK_TREES alone resolves the farm (legacy alias)" || fail "CATALYST_WORK_TREES alone resolves the farm" "$outv2"
outv3="$(CATALYST_WORKTREES_DIR="${BASE}/wt" CATALYST_WORK_TREES="/nonexistent/other/farm" CATALYST_LOGS_DIR="${SCRATCH}/logs-v3" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run 2>&1)"
printf '%s' "$outv3" | grep -q 'scanned=1[01]' && ok "control: CATALYST_WORKTREES_DIR wins when both are set and disagree" || fail "CATALYST_WORKTREES_DIR wins over CATALYST_WORK_TREES" "$outv3"

# ── the classifier hook (D7: may only downgrade toward KEEP) ────────────────────────────────
HOOK_KEEP="${SCRATCH}/bin/hook-keep-a.sh"
cat > "$HOOK_KEEP" <<EOS
#!/usr/bin/env bash
rec="\$(cat)"
path="\$(printf '%s' "\$rec" | jq -r .path)"
case "\$path" in
  */CTC-A) printf '{"verdict":"KEEP","reason":"operator-pinned"}' ;;
  *) exit 0 ;;
esac
EOS
chmod +x "$HOOK_KEEP"
outh1="$(run_prune --dry-run --json 2>&1 <<<"" )"
outh1="$(CATALYST_WORKTREES_DIR="${BASE}/wt" CATALYST_LOGS_DIR="${SCRATCH}/logs-hook1" CATALYST_WORKTREE_STALE_DAYS=0 CATALYST_WT_CLASSIFIER="$HOOK_KEEP" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run --json 2>&1)"
if printf '%s' "$outh1" | grep "\"path\":\"${BASE}/wt/repo/CTC-A\"" | grep -q '"reason":"hook-keep:operator-pinned"'; then
  ok "a hook returning KEEP downgrades a REMOVE candidate, reason names the hook"
else
  fail "hook KEEP downgrade" "$outh1"
fi

HOOK_UPGRADE="${SCRATCH}/bin/hook-upgrade-b.sh"
cat > "$HOOK_UPGRADE" <<EOS
#!/usr/bin/env bash
rec="\$(cat)"
path="\$(printf '%s' "\$rec" | jq -r .path)"
case "\$path" in
  */CTC-B) printf '{"verdict":"REMOVE"}' ;;
  *) exit 0 ;;
esac
EOS
chmod +x "$HOOK_UPGRADE"
outh2="$(CATALYST_WORKTREES_DIR="${BASE}/wt" CATALYST_LOGS_DIR="${SCRATCH}/logs-hook2" CATALYST_WORKTREE_STALE_DAYS=0 CATALYST_WT_CLASSIFIER="$HOOK_UPGRADE" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run --json 2>&1)"
bline="$(printf '%s' "$outh2" | grep "\"path\":\"${BASE}/wt/repo/CTC-B\"")"
if printf '%s' "$bline" | tail -1 | grep -q '"verdict":"KEEP","reason":"dirty"'; then
  ok "a hook returning REMOVE for a built-in-KEEP tree is ignored — CTC-B stays KEEP/dirty"
else
  fail "hook REMOVE upgrade is ignored" "$bline"
fi

# ── first-run rule (Gherkin scenario 4) and the apply path (Gherkin scenario 1, removal half) ─
APPLYBASE="${SCRATCH}/apply-farm"
mkdir -p "$APPLYBASE"
build_farm_fixture "$APPLYBASE"
APPLYLOGS="${SCRATCH}/apply-logs"
run_apply() {
  CATALYST_WORKTREES_DIR="${APPLYBASE}/wt" CATALYST_LOGS_DIR="$APPLYLOGS" CATALYST_WORKTREE_STALE_DAYS=0 \
  WT_GUARD_LSOF="$LSOF_STUB" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" "$@"
}

out6="$(run_apply --apply 2>&1)"
if [ -d "${APPLYBASE}/wt/repo/CTC-A" ] && printf '%s' "$out6" | grep -q 'mode=dry-run-first-run'; then
  ok "no receipt + --apply removes NOTHING, mode=dry-run-first-run"
else
  fail "first --apply is a dry run" "$out6"
fi
[ -f "${APPLYLOGS}/prune-worktrees/first-run-receipt.json" ] && ok "the receipt now exists after the first run" || fail "receipt written after first run"

out7="$(run_apply --apply 2>&1)"
if [ ! -d "${APPLYBASE}/wt/repo/CTC-A" ] && [ ! -d "${APPLYBASE}/wt/repo/CTC-H" ]; then
  ok "second --apply (receipt present): CTC-A and CTC-H are gone from disk"
else
  fail "second --apply removes the eligible trees" "$out7"
fi
for kept in CTC-B CTC-C CTC-I CTC-J CTC-K; do
  [ -d "${APPLYBASE}/wt/repo/${kept}" ] && ok "${kept} still present after apply" || fail "${kept} still present after apply"
done

# losslessness (D3)
sha_now="$(git -C "${APPLYBASE}/primary" rev-parse CTC-A 2>/dev/null)"
if git -C "${APPLYBASE}/primary" branch --list CTC-A | grep -q CTC-A \
  && [ -n "$sha_now" ] \
  && [ "$(git -C "${APPLYBASE}/primary" cat-file -t "$sha_now" 2>/dev/null)" = "commit" ] \
  && ! git -C "${APPLYBASE}/primary" worktree list | grep -q "wt/repo/CTC-A "; then
  ok "removal is lossless: branch, tip sha and commit object all survive; only the checkout is gone"
else
  fail "removal is lossless"
fi

# no --force reached any actual invocation in this run's log
if grep -q -- '--force' "$(ls -t "${APPLYLOGS}/prune-worktrees"/*.jsonl | head -1)" 2>/dev/null; then
  fail "the applying run's log carries no --force"
else
  ok "the applying run's log carries no --force"
fi

# receipt reset returns the next run to dry-run (positive control)
rm -f "${APPLYLOGS}/prune-worktrees/first-run-receipt.json"
CTLBASE="${SCRATCH}/apply-farm2"
mkdir -p "$CTLBASE"
build_farm_fixture "$CTLBASE"
CTLLOGS="${SCRATCH}/apply-logs2"
CATALYST_WORKTREES_DIR="${CTLBASE}/wt" CATALYST_LOGS_DIR="$CTLLOGS" CATALYST_WORKTREE_STALE_DAYS=0 WT_GUARD_LSOF="$LSOF_STUB" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --apply >/dev/null
rm -f "${CTLLOGS}/prune-worktrees/first-run-receipt.json"
out8="$(CATALYST_WORKTREES_DIR="${CTLBASE}/wt" CATALYST_LOGS_DIR="$CTLLOGS" CATALYST_WORKTREE_STALE_DAYS=0 WT_GUARD_LSOF="$LSOF_STUB" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --apply 2>&1)"
printf '%s' "$out8" | grep -q 'mode=dry-run-first-run' && ok "control: deleting the receipt returns the next --apply to a dry run" || fail "deleting the receipt returns to dry-run" "$out8"

# liveness guard is wired, not merely carried (CTC-2456's F2 lesson)
NOLSOFBASE="${SCRATCH}/no-lsof-farm"
mkdir -p "$NOLSOFBASE"
build_farm_fixture "$NOLSOFBASE"
NOLSOFLOGS="${SCRATCH}/no-lsof-logs"
env -u PATH PATH=/usr/bin:/bin bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --apply >/dev/null 2>&1 <<<"" || true
CATALYST_WORKTREES_DIR="${NOLSOFBASE}/wt" CATALYST_LOGS_DIR="$NOLSOFLOGS" CATALYST_WORKTREE_STALE_DAYS=0 WT_GUARD_LSOF=/definitely/not/lsof bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --apply >/dev/null 2>&1
out9="$(CATALYST_WORKTREES_DIR="${NOLSOFBASE}/wt" CATALYST_LOGS_DIR="$NOLSOFLOGS" CATALYST_WORKTREE_STALE_DAYS=0 WT_GUARD_LSOF=/definitely/not/lsof bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --apply --json 2>&1)"
if [ -d "${NOLSOFBASE}/wt/repo/CTC-A" ] && printf '%s' "$out9" | grep "\"path\":\"${NOLSOFBASE}/wt/repo/CTC-A\"" | grep -q '"reason":"liveness-unprovable"'; then
  ok "with no usable lsof: every otherwise-REMOVE tree becomes KEEP/liveness-unprovable, nothing removed"
else
  fail "unprovable liveness keeps the tree" "$out9"
fi

# cwd containment
CWDBASE="${SCRATCH}/cwd-farm"
mkdir -p "$CWDBASE"
build_farm_fixture "$CWDBASE"
CWDLOGS="${SCRATCH}/cwd-logs"
CATALYST_WORKTREES_DIR="${CWDBASE}/wt" CATALYST_LOGS_DIR="$CWDLOGS" CATALYST_WORKTREE_STALE_DAYS=0 WT_GUARD_LSOF="$LSOF_STUB" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --apply >/dev/null 2>&1
outcwd="$(cd "${CWDBASE}/wt/repo/CTC-A" && CATALYST_WORKTREES_DIR="${CWDBASE}/wt" CATALYST_LOGS_DIR="$CWDLOGS" CATALYST_WORKTREE_STALE_DAYS=0 WT_GUARD_LSOF="$LSOF_STUB" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --apply --json 2>&1)"
if [ -d "${CWDBASE}/wt/repo/CTC-A" ] && printf '%s' "$outcwd" | grep "\"path\":\"${CWDBASE}/wt/repo/CTC-A\"" | grep -q '"reason":"cwd-containment"'; then
  ok "cwd inside a REMOVE candidate refuses removal (cwd-containment)"
else
  fail "cwd containment refuses removal" "$outcwd"
fi

# administrative prune, not counted as a removal
PRUNEBASE="${SCRATCH}/prune-admin-farm"
mkdir -p "$PRUNEBASE"
build_farm_fixture "$PRUNEBASE"
PRUNELOGS="${SCRATCH}/prune-admin-logs"
CATALYST_WORKTREES_DIR="${PRUNEBASE}/wt" CATALYST_LOGS_DIR="$PRUNELOGS" CATALYST_WORKTREE_STALE_DAYS=0 WT_GUARD_LSOF="$LSOF_STUB" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --apply >/dev/null 2>&1
CATALYST_WORKTREES_DIR="${PRUNEBASE}/wt" CATALYST_LOGS_DIR="$PRUNELOGS" CATALYST_WORKTREE_STALE_DAYS=0 WT_GUARD_LSOF="$LSOF_STUB" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --apply >/dev/null 2>&1
lastlog="$(ls -t "${PRUNELOGS}/prune-worktrees"/*.jsonl | head -1)"
if grep -q '"kind":"administrative-prune"' "$lastlog" && ! git -C "${PRUNEBASE}/primary" worktree list --porcelain | grep -q '^prunable'; then
  ok "a prunable stub is administratively pruned, and git no longer lists it as prunable"
else
  fail "administrative prune runs and clears git's own prunable state" "$lastlog"
fi

# idempotence: a third apply with nothing left to remove still exits 0 with a log+summary
out10="$(run_apply --apply 2>&1)"; rc10=$?
[ "$rc10" -eq 0 ] && printf '%s' "$out10" | grep -q 'removed=0' && ok "a run with nothing left to remove exits 0 and reports removed=0" || fail "idempotent apply" "rc=$rc10 $out10"

# ── 4. install-schedule.sh: render, stage, refuse ────────────────────────────────────────────
echo ""
echo "install-schedule.sh"

r_systemd="$(bash "${SKILL_DIR}/scripts/install-schedule.sh" --render systemd)"
for needle in '[Unit]' '[Service]' '[Timer]' 'OnCalendar=daily' 'Persistent=true' 'RandomizedDelaySec=' 'Type=oneshot' 'Nice=19' 'IOSchedulingClass=idle'; do
  printf '%s' "$r_systemd" | grep -qF "$needle" && ok "render systemd contains ${needle}" || fail "render systemd contains ${needle}"
done
printf '%s' "$r_systemd" | grep -qE 'ExecStart=.*prune-worktrees\.sh --apply' && ok "render systemd's ExecStart names prune-worktrees.sh --apply" || fail "render systemd ExecStart"

r_launchd="$(bash "${SKILL_DIR}/scripts/install-schedule.sh" --render launchd)"
for needle in 'RunAtLoad' '<false/>' 'StartCalendarInterval' 'Nice' 'LowPriorityIO' '<true/>' 'Label'; do
  printf '%s' "$r_launchd" | grep -qF "$needle" && ok "render launchd contains ${needle}" || fail "render launchd contains ${needle}"
done
opens="$(printf '%s' "$r_launchd" | grep -oc '<dict>')"
closes="$(printf '%s' "$r_launchd" | grep -oc '</dict>')"
[ "$opens" = "$closes" ] && [ "$opens" -gt 0 ] && ok "launchd plist: <dict> and </dict> are balanced (${opens})" || fail "launchd plist dict balance" "opens=$opens closes=$closes"

r_cron="$(bash "${SKILL_DIR}/scripts/install-schedule.sh" --render cron)"
cron_lines="$(printf '%s' "$r_cron" | sed -n '/# BEGIN catalyst-prune-worktrees/,/# END catalyst-prune-worktrees/p' | sed '1d;$d' | grep -c .)"
[ "$cron_lines" = 1 ] && ok "render cron: exactly one line between BEGIN/END" || fail "render cron: exactly one line between BEGIN/END" "$cron_lines"

r_systemd2="$(bash "${SKILL_DIR}/scripts/install-schedule.sh" --render systemd)"
[ "$r_systemd" = "$r_systemd2" ] && ok "rendered systemd form is byte-identical across two runs on the same host" || fail "same-host determinism"

r_systemd_other="$(env HOSTNAME=buildbox-01 bash -c 'hostname() { echo buildbox-01; }; export -f hostname; exec bash "'"${SKILL_DIR}"'/scripts/install-schedule.sh" --render systemd')"
if [ "$r_systemd" != "$r_systemd_other" ]; then
  ok "control: a different hostname renders a different jitter value"
else
  fail "control: a different hostname renders a different jitter value"
fi

for platform in systemd launchd cron; do
  for r in "$r_systemd" "$r_launchd" "$r_cron"; do :; done
done
if printf '%s%s%s' "$r_systemd" "$r_launchd" "$r_cron" | grep -qE '/(Users|home)/[a-z][a-z0-9_-]+/'; then
  fail "no rendered form contains an absolute /home/<user>/ or /Users/<user>/ path"
else
  ok "no rendered form contains an absolute /home/<user>/ or /Users/<user>/ path"
fi

STAGE="${SCRATCH}/stage"
bash "${SKILL_DIR}/scripts/install-schedule.sh" --install --root "$STAGE" --platform systemd >/dev/null
if [ -f "${STAGE}/systemd/user/catalyst-prune-worktrees.service" ] && [ -f "${STAGE}/systemd/user/catalyst-prune-worktrees.timer" ]; then
  ok "--install --root stages exactly the systemd service+timer files"
else
  fail "--install --root stages the systemd files"
fi
before="$(cat "${STAGE}/systemd/user/catalyst-prune-worktrees.service")"
bash "${SKILL_DIR}/scripts/install-schedule.sh" --install --root "$STAGE" --platform systemd >/dev/null
after="$(cat "${STAGE}/systemd/user/catalyst-prune-worktrees.service")"
[ "$before" = "$after" ] && ok "a second --install --root is a no-op: files byte-identical" || fail "idempotent --install --root"
[ "$(bash "${SKILL_DIR}/scripts/install-schedule.sh" --status --root "$STAGE" --platform systemd)" = "installed" ] && ok "--status --root reports installed" || fail "--status --root reports installed"
bash "${SKILL_DIR}/scripts/install-schedule.sh" --uninstall --root "$STAGE" --platform systemd >/dev/null
if [ ! -f "${STAGE}/systemd/user/catalyst-prune-worktrees.service" ] && [ ! -f "${STAGE}/systemd/user/catalyst-prune-worktrees.timer" ]; then
  ok "--uninstall --root removes exactly the staged files"
else
  fail "--uninstall --root removes the staged files"
fi
[ "$(bash "${SKILL_DIR}/scripts/install-schedule.sh" --status --root "$STAGE" --platform systemd)" = "not-installed" ] && ok "--status --root reports not-installed after uninstall" || fail "--status --root not-installed"

# positive control: with --root set, no stub systemctl on PATH is ever invoked
STUBDIR="${SCRATCH}/systemctl-stub"
mkdir -p "$STUBDIR"
STUBLOG="${SCRATCH}/systemctl-stub.log"
cat > "${STUBDIR}/systemctl" <<EOS
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "${STUBLOG}"
exit 0
EOS
chmod +x "${STUBDIR}/systemctl"
: > "$STUBLOG"
PATH="${STUBDIR}:${PATH}" bash "${SKILL_DIR}/scripts/install-schedule.sh" --install --root "${SCRATCH}/stage-stub" --platform systemd >/dev/null
if [ ! -s "$STUBLOG" ]; then
  ok "control: a stub systemctl on PATH is never invoked when --root is set"
else
  fail "control: stub systemctl not invoked under --root" "$(cat "$STUBLOG")"
fi

# refusal: requested platform's scheduler AND crontab both unavailable, no --root → nothing written.
#
# The scheduler-free PATH is CONSTRUCTED, not assumed. `PATH=/usr/bin:/bin` only means "no
# scheduler" on a bare container: an ordinary Linux box — every GitHub ubuntu runner — carries
# /usr/bin/systemctl and /usr/bin/crontab, so this test used to take the real install path there,
# write a unit into $HOME and fail its own "writes nothing" assertion. Green locally, red in CI.
NOSCHED_BIN="${SCRATCH}/nosched-bin"
mkdir -p "$NOSCHED_BIN"
for t in bash sh hostname cksum awk uname dirname basename mktemp jq chmod mkdir mv rm cat sed grep id date find ls; do
  t_src="$(command -v "$t" 2>/dev/null)" && ln -sf "$t_src" "${NOSCHED_BIN}/${t}"
done
if PATH="$NOSCHED_BIN" command -v systemctl >/dev/null 2>&1 \
  || PATH="$NOSCHED_BIN" command -v launchctl >/dev/null 2>&1 \
  || PATH="$NOSCHED_BIN" command -v crontab >/dev/null 2>&1; then
  fail "control: the constructed PATH carries no scheduler" "$(ls "$NOSCHED_BIN")"
else
  ok "control: the constructed PATH carries no systemctl/launchctl/crontab"
fi
out_refuse="$(env PATH="$NOSCHED_BIN" HOME="${SCRATCH}/refuse-home" bash "${SKILL_DIR}/scripts/install-schedule.sh" --install --platform systemd 2>&1)"; rc_refuse=$?
if [ "$rc_refuse" -ne 0 ] && printf '%s' "$out_refuse" | grep -qi 'systemd' && printf '%s' "$out_refuse" | grep -qi 'cron' \
  && [ ! -e "${SCRATCH}/refuse-home/.config/systemd" ]; then
  ok "no usable scheduler on PATH: refuses, names both, writes nothing"
else
  fail "no-scheduler refusal" "rc=$rc_refuse out=$out_refuse"
fi

# positive control: the refusal above is a real branch, not a vacuous one — put a crontab on the
# same PATH and the installer falls back to cron, says so, and installs the block.
FALLBACK_BIN="${SCRATCH}/fallback-bin"
cp -a "$NOSCHED_BIN" "$FALLBACK_BIN"
CRONTAB_STUB_LOG="${SCRATCH}/crontab-stub.log"
cat > "${FALLBACK_BIN}/crontab" <<EOS
#!/usr/bin/env bash
if [ "\${1:-}" = "-l" ]; then
  [ -f "${CRONTAB_STUB_LOG}" ] && cat "${CRONTAB_STUB_LOG}"
  exit 0
fi
cat > "${CRONTAB_STUB_LOG}"
exit 0
EOS
chmod +x "${FALLBACK_BIN}/crontab"
out_fb="$(env PATH="$FALLBACK_BIN" HOME="${SCRATCH}/fallback-home" bash "${SKILL_DIR}/scripts/install-schedule.sh" --install --platform systemd 2>&1)"; rc_fb=$?
if [ "$rc_fb" -eq 0 ] && printf '%s' "$out_fb" | grep -qi 'falling back to cron' \
  && grep -q '# BEGIN catalyst-prune-worktrees' "$CRONTAB_STUB_LOG" 2>/dev/null; then
  ok "control: with crontab present the installer falls back to cron, names the fallback, installs the block"
else
  fail "control: cron fallback installs" "rc=$rc_fb out=$out_fb crontab=$(cat "$CRONTAB_STUB_LOG" 2>/dev/null)"
fi

# ── 5. offer-schedule.sh: propose / accept / decline / persist ──────────────────────────────
echo ""
echo "offer-schedule.sh"

OFFER_CFG="${SCRATCH}/housekeeping.json"
run_offer() { CATALYST_PRUNE_CONFIG="$OFFER_CFG" bash "${SKILL_DIR}/scripts/offer-schedule.sh" "$@"; }

out_o1="$(run_offer 2>&1)"
printf '%s' "$out_o1" | grep -qi 'schedule\|daily' && printf '%s' "$out_o1" | grep -qi 'retention\|days' \
  && ok "no recorded answer: proposes both a schedule and a retention window" || fail "propose names schedule and retention" "$out_o1"
[ ! -f "$OFFER_CFG" ] && ok "propose writes no config" || fail "propose writes no config"

out_o2="$(run_offer --accept --root "${SCRATCH}/offer-stage" 2>&1)"
if jq -e '.housekeeping.answer == "accepted" or .housekeeping.answer == "accept"' "$OFFER_CFG" >/dev/null 2>&1 \
  && jq -e 'has("housekeeping") and (.housekeeping | has("schedule")) and (.housekeeping | has("retentionDays")) and (.housekeeping | has("answeredAt")) and (.housekeeping | has("actor")) and (.housekeeping | has("skillVersion"))' "$OFFER_CFG" >/dev/null 2>&1; then
  ok "--accept writes answer + schedule + retentionDays + answeredAt + actor + skillVersion"
else
  fail "--accept writes the full record" "$(cat "$OFFER_CFG")"
fi
[ -f "${SCRATCH}/offer-stage/systemd/user/catalyst-prune-worktrees.service" -o -f "${SCRATCH}/offer-stage/Library/LaunchAgents/dev.catalyst.prune-worktrees.plist" -o -f "${SCRATCH}/offer-stage/crontab-block" ] \
  && ok "--accept installs the schedule (staged under --root)" || fail "--accept installs the schedule"

out_o3="$(run_offer 2>&1)"
printf '%s' "$out_o3" | grep -qi 'not asking again\|already' && ok "a bare run after --accept prints the recorded answer and does not re-propose" || fail "does not re-propose after accept" "$out_o3"

rm -f "$OFFER_CFG"
out_o4="$(run_offer --decline 2>&1)"
jq -e '.housekeeping.answer == "declined" or .housekeeping.answer == "decline"' "$OFFER_CFG" >/dev/null 2>&1 && ok "--decline writes answer=declined" || fail "--decline writes answer=declined"
[ ! -e "${SCRATCH}/decline-no-install" ] && ok "--decline installs nothing" || fail "--decline installs nothing"

out_o5="$(run_offer 2>&1)"
printf '%s' "$out_o5" | grep -qi 'not asking again\|already' && ok "a bare run after --decline does not re-propose" || fail "does not re-propose after decline" "$out_o5"

# positive control: removing the config makes it propose again
rm -f "$OFFER_CFG"
out_o6="$(run_offer 2>&1)"
printf '%s' "$out_o6" | grep -qiv 'already' && ! printf '%s' "$out_o6" | grep -qi 'already' && ok "control: with the config removed, it proposes again" || fail "control: propose again after config removal" "$out_o6"

run_offer --decline >/dev/null
run_offer --reset >/dev/null
out_o7="$(run_offer 2>&1)"
printf '%s' "$out_o7" | grep -qi 'already' && fail "--reset clears the answer so it proposes once more" "$out_o7" || ok "--reset clears the answer so it proposes once more"

run_offer --decline --retention-days 30 >/dev/null
jq -e '.housekeeping.retentionDays == 30' "$OFFER_CFG" >/dev/null 2>&1 && ok "--retention-days 30 records 30" || fail "--retention-days records the value"

echo '{"unrelated":"survives"}' > "${SCRATCH}/clobber-cfg.json"
CATALYST_PRUNE_CONFIG="${SCRATCH}/clobber-cfg.json" bash "${SKILL_DIR}/scripts/offer-schedule.sh" --decline >/dev/null
jq -e '.unrelated == "survives"' "${SCRATCH}/clobber-cfg.json" >/dev/null 2>&1 && ok "control: an unrelated pre-existing key survives a write" || fail "unrelated key survives a write"

echo 'not valid json' > "${SCRATCH}/malformed-cfg.json"
out_o8="$(CATALYST_PRUNE_CONFIG="${SCRATCH}/malformed-cfg.json" bash "${SKILL_DIR}/scripts/offer-schedule.sh" --decline 2>&1)"; rc_o8=$?
malformed_after="$(cat "${SCRATCH}/malformed-cfg.json")"
if [ "$rc_o8" -ne 0 ] && [ "$malformed_after" = "not valid json" ] && printf '%s' "$out_o8" | grep -qF "${SCRATCH}/malformed-cfg.json"; then
  ok "a malformed existing config refuses, leaves the file untouched, and names the path"
else
  fail "malformed config refusal" "rc=$rc_o8 out=$out_o8"
fi

rm -f "$OFFER_CFG"
run_offer --decline >/dev/null
out_o9="$(run_offer --json 2>&1)"
printf '%s' "$out_o9" | jq -e . >/dev/null 2>&1 && ok "--json prints the recorded answer as one JSON object" || fail "--json output parses" "$out_o9"


# ── 6. Regressions fixed in the CTC-2550 remediate round ────────────────────────────────────
# Every check below fails against the scripts as they stood at 306a4ce.
echo ""
echo "Regressions (remediate round)"

# C1 — an unmerged branch whose only change is a path containing a space must never be REMOVE.
# `git diff --quiet -- $paths` unquoted split it into two pathspecs that matched nothing, and a
# pathspec matching nothing exits 0 — the fail-open this skill exists to prevent.
# C5 — a branch merged with a real merge commit must be reclaimed, not reported as if it had no
# work ("no-commits-beyond-base").
SPACEBASE="${SCRATCH}/space-farm"
mkdir -p "$SPACEBASE"
build_farm_fixture "$SPACEBASE"
git -C "${SPACEBASE}/primary" worktree add -q -b CTC-SP "${SPACEBASE}/wt/repo/CTC-SP" origin/main
( cd "${SPACEBASE}/wt/repo/CTC-SP" && git config user.email t@t.t && git config user.name t \
    && echo secret-unmerged-work > "a file.txt" && git add -A && git commit -q -m sp )
git -C "${SPACEBASE}/primary" worktree add -q -b CTC-MC "${SPACEBASE}/wt/repo/CTC-MC" origin/main
( cd "${SPACEBASE}/wt/repo/CTC-MC" && git config user.email t@t.t && git config user.name t \
    && echo mc1 > mc1.txt && git add mc1.txt && git commit -q -m mc1 )
( cd "${SPACEBASE}/primary" && git checkout -q main && git pull -q origin main \
    && git merge -q --no-ff -m "merge CTC-MC" CTC-MC && git push -q origin main )
out_reg="$(CATALYST_WORKTREES_DIR="${SPACEBASE}/wt" CATALYST_LOGS_DIR="${SCRATCH}/logs-reg" \
  CATALYST_WORKTREE_STALE_DAYS=0 WT_GUARD_LSOF="$LSOF_STUB" \
  bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run --json 2>&1)"
line_of() { printf '%s\n' "$out_reg" | grep "\"path\":\"${SPACEBASE}/wt/repo/$1\"" | head -1; }

if printf '%s' "$(line_of CTC-SP)" | grep -q '"verdict":"KEEP"'; then
  ok "C1: an unmerged branch touching 'a file.txt' is KEEP, not REMOVE (quoted pathspec)"
else
  fail "C1: spaced path must not read as merged" "$(line_of CTC-SP)"
fi
# control: the same branch IS the one with a spaced path, and git agrees it is unmerged
if git -C "${SPACEBASE}/primary" merge-base --is-ancestor refs/heads/CTC-SP origin/main 2>/dev/null; then
  fail "control: CTC-SP really is unmerged" "git says it is an ancestor of origin/main"
else
  ok "control: git itself confirms CTC-SP is not in origin/main"
fi
if printf '%s' "$(line_of CTC-MC)" | grep -q '"verdict":"REMOVE","reason":"merged:ancestor-of-origin/main"'; then
  ok "C5: a branch merged by merge-commit is REMOVE/merged:ancestor-of-origin/main"
else
  fail "C5: merge-commit-merged branch is reclaimed" "$(line_of CTC-MC)"
fi

# C6 — a trailing slash on the farm root must not turn the whole run into a silent no-op.
out_slash="$(CATALYST_WORKTREES_DIR="${BASE}/wt/" CATALYST_LOGS_DIR="${SCRATCH}/logs-slash" \
  CATALYST_WORKTREE_STALE_DAYS=0 bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run --json 2>&1)"
slash_a="$(printf '%s\n' "$out_slash" | grep "\"path\":\"${BASE}/wt/repo/CTC-A\"" | head -1)"
if printf '%s' "$slash_a" | grep -q '"verdict":"REMOVE"' \
  && ! printf '%s\n' "$out_slash" | grep -q '"reason":"unsupported-farm-depth:[3-9]'; then
  ok "C6: a farm root with a trailing slash classifies exactly as one without"
else
  fail "C6: trailing slash must not break depth resolution" "$slash_a"
fi

# C3 / M2 — the retention window is a real gate (it was left with no coverage at all), and it is
# built with POSIX `find -mtime`, never GNU-only `touch -d "-N days"` whose macOS fallback
# stamped the threshold at NOW and disabled the gate silently.
out_ret="$(CATALYST_WORKTREES_DIR="${BASE}/wt" CATALYST_LOGS_DIR="${SCRATCH}/logs-ret" \
  env -u CATALYST_WORKTREE_STALE_DAYS bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run --json 2>&1)"
ret_a="$(printf '%s\n' "$out_ret" | grep "\"path\":\"${BASE}/wt/repo/CTC-A\"" | head -1)"
if printf '%s' "$ret_a" | grep -q '"verdict":"KEEP","reason":"within-retention-window:14d"'; then
  ok "M2: with the default window, a freshly-touched merged tree is KEEP/within-retention-window:14d"
else
  fail "M2: the retention window keeps a fresh merged tree" "$ret_a"
fi
# control: the same tree with the window disabled is REMOVE — so the KEEP above is the window,
# not some other gate
if printf '%s' "$(printf '%s\n' "$out" | grep "\"path\":\"${BASE}/wt/repo/CTC-A\"" | head -1)" | grep -q '"verdict":"REMOVE"'; then
  ok "control: the same tree with CATALYST_WORKTREE_STALE_DAYS=0 is REMOVE"
else
  fail "control: window=0 removes the same tree"
fi
# (comment lines describing the rejected spelling are not invocations — exclude them, as 2a does)
touch_hits="$(grep -n 'touch -d' "${SKILL_DIR}/scripts/prune-worktrees.sh" | grep -vE '^[0-9]+:[[:space:]]*#')"
if [ -n "$touch_hits" ]; then
  fail "C3: no GNU-only 'touch -d' threshold in the retention gate" "$touch_hits"
else
  ok "C3: the retention gate uses no GNU-only 'touch -d' threshold"
fi
tmp_touch="$(mktemp)"; printf '  touch -d "-${days} days" "$threshold"\n' > "$tmp_touch"
if [ -n "$(grep -n 'touch -d' "$tmp_touch" | grep -vE '^[0-9]+:[[:space:]]*#')" ]; then
  ok "control: a planted 'touch -d' line IS reported"
else
  fail "control: planted 'touch -d' reported"
fi
rm -f "$tmp_touch"
out_badret="$(CATALYST_WORKTREES_DIR="${BASE}/wt" CATALYST_LOGS_DIR="${SCRATCH}/logs-badret" \
  CATALYST_WORKTREE_STALE_DAYS=notanumber bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run 2>&1)"; rc_badret=$?
if [ "$rc_badret" -eq 3 ] && printf '%s' "$out_badret" | grep -qF 'CATALYST_WORKTREE_STALE_DAYS'; then
  ok "a non-numeric retention window refuses the run (exit 3) instead of evaluating to 'no window'"
else
  fail "non-numeric retention window refuses" "rc=$rc_badret out=$out_badret"
fi

# C8 — a classifier hook that cannot be used must keep the tree. D7 makes it a downgrade-only
# safety valve; a crashed valve told us nothing, and nothing is not consent to delete.
HOOK_CRASH="${SCRATCH}/bin/hook-crash.sh"
printf '#!/usr/bin/env bash\ncat >/dev/null\nexit 7\n' > "$HOOK_CRASH"; chmod +x "$HOOK_CRASH"
outc8="$(CATALYST_WORKTREES_DIR="${BASE}/wt" CATALYST_LOGS_DIR="${SCRATCH}/logs-c8a" CATALYST_WORKTREE_STALE_DAYS=0 \
  CATALYST_WT_CLASSIFIER="$HOOK_CRASH" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run --json 2>&1)"
if printf '%s\n' "$outc8" | grep "\"path\":\"${BASE}/wt/repo/CTC-A\"" | grep -q '"verdict":"KEEP","reason":"hook-unusable:crashed"'; then
  ok "C8: a hook that exits non-zero keeps the tree (hook-unusable:crashed)"
else
  fail "C8: crashed hook keeps the tree" "$(printf '%s\n' "$outc8" | grep "${BASE}/wt/repo/CTC-A" | head -1)"
fi
HOOK_GARBAGE="${SCRATCH}/bin/hook-garbage.sh"
printf '#!/usr/bin/env bash\ncat >/dev/null\nprintf %%s "not json at all"\n' > "$HOOK_GARBAGE"; chmod +x "$HOOK_GARBAGE"
outc8b="$(CATALYST_WORKTREES_DIR="${BASE}/wt" CATALYST_LOGS_DIR="${SCRATCH}/logs-c8b" CATALYST_WORKTREE_STALE_DAYS=0 \
  CATALYST_WT_CLASSIFIER="$HOOK_GARBAGE" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run --json 2>&1)"
if printf '%s\n' "$outc8b" | grep "\"path\":\"${BASE}/wt/repo/CTC-A\"" | grep -q '"verdict":"KEEP","reason":"hook-unusable:unparseable"'; then
  ok "C8: a hook whose output cannot be parsed keeps the tree (hook-unusable:unparseable)"
else
  fail "C8: unparseable hook output keeps the tree" "$(printf '%s\n' "$outc8b" | grep "${BASE}/wt/repo/CTC-A" | head -1)"
fi

# C9 — no world-predictable /tmp redirect target on a shared machine (`>` follows a symlink).
if grep -RnE '2>/tmp/' "${SKILL_DIR}/scripts" >/dev/null; then
  fail "C9: no predictable /tmp redirect targets in scripts/" "$(grep -RnE '2>/tmp/' "${SKILL_DIR}/scripts")"
else
  ok "C9: no predictable /tmp redirect targets in scripts/"
fi
tmp_redir="$(mktemp)"; printf 'cmd 2>/tmp/prune-wt-guard-err.$$\n' > "$tmp_redir"
grep -qE '2>/tmp/' "$tmp_redir" && ok "control: a planted '2>/tmp/...' redirect IS reported" || fail "control: planted /tmp redirect reported"
rm -f "$tmp_redir"

# C10 — a dry run reports what it WOULD remove; `removed` counts only real deletions.
if [ -n "$LOG1" ] && grep '"kind":"summary"' "$LOG1" | jq -e '.removed == 0 and .wouldRemove == 3' >/dev/null 2>&1; then
  ok "C10: the dry run's summary is removed=0, wouldRemove=3"
else
  fail "C10: dry-run summary separates removed from wouldRemove" "$(grep '"kind":"summary"' "${LOG1}")"
fi
if grep -h '"kind":"summary"' "${APPLYLOGS}/prune-worktrees"/*-apply.jsonl 2>/dev/null \
    | jq -se 'any(.[]; .removed > 0 and .wouldRemove == 0)' >/dev/null 2>&1; then
  ok "C10: an applying run counts its deletions in removed, with wouldRemove=0"
else
  fail "C10: apply summary counts removals" "$(grep -h '"kind":"summary"' "${APPLYLOGS}/prune-worktrees"/*-apply.jsonl 2>/dev/null)"
fi

# C11 — two runs in the same second and mode must both keep their log.
COLLOGS="${SCRATCH}/collide-logs"
for _ in 1 2; do
  CATALYST_WORKTREES_DIR="${BASE}/wt" CATALYST_LOGS_DIR="$COLLOGS" CATALYST_WORKTREE_STALE_DAYS=0 \
    CATALYST_PRUNE_NOW="2026-01-02T03:04:05Z" bash "${SKILL_DIR}/scripts/prune-worktrees.sh" --dry-run >/dev/null 2>&1
done
col_n="$(ls "${COLLOGS}/prune-worktrees"/*.jsonl 2>/dev/null | wc -l | tr -d ' ')"
col_summaries="$(grep -lh '"kind":"summary"' "${COLLOGS}/prune-worktrees"/*.jsonl 2>/dev/null | wc -l | tr -d ' ')"
if [ "$col_n" = 2 ] && [ "$col_summaries" = 2 ]; then
  ok "C11: two runs with the same timestamp and mode keep both logs, each with its summary"
else
  fail "C11: same-second runs must not overwrite each other's log" "logs=$col_n with-summary=$col_summaries"
fi

# ── M1 / C4: the accepted answer is what actually gets installed ─────────────────────────────
echo ""
echo "The accepted schedule and window reach the unit (M1/C4)"

r_sys_w="$(bash "${SKILL_DIR}/scripts/install-schedule.sh" --render systemd --schedule weekly --retention-days 30)"
printf '%s' "$r_sys_w" | grep -qF 'OnCalendar=weekly' && ok "systemd: --schedule weekly renders OnCalendar=weekly" || fail "systemd cadence is plumbed" "$r_sys_w"
printf '%s' "$r_sys_w" | grep -qF 'Environment=CATALYST_WORKTREE_STALE_DAYS=30' && ok "systemd: --retention-days 30 reaches the unit's Environment=" || fail "systemd retention is plumbed" "$r_sys_w"

r_lau_w="$(bash "${SKILL_DIR}/scripts/install-schedule.sh" --render launchd --schedule weekly --retention-days 30)"
printf '%s' "$r_lau_w" | grep -qF '<key>Weekday</key>' && ok "launchd: weekly adds a Weekday key" || fail "launchd cadence is plumbed" "$r_lau_w"
printf '%s' "$r_lau_w" | grep -qF 'CATALYST_WORKTREE_STALE_DAYS' && printf '%s' "$r_lau_w" | grep -qF '<string>30</string>' \
  && ok "launchd: the window reaches EnvironmentVariables" || fail "launchd retention is plumbed" "$r_lau_w"
lau_opens="$(printf '%s' "$r_lau_w" | grep -oc '<dict>')"; lau_closes="$(printf '%s' "$r_lau_w" | grep -oc '</dict>')"
[ "$lau_opens" = "$lau_closes" ] && ok "launchd weekly plist keeps <dict> balance (${lau_opens})" || fail "launchd weekly dict balance" "$lau_opens/$lau_closes"

r_cron_w="$(bash "${SKILL_DIR}/scripts/install-schedule.sh" --render cron --schedule weekly --retention-days 30)"
printf '%s' "$r_cron_w" | grep -qE '^[0-9]+ 3 \* \* 0 ' && ok "cron: weekly renders a day-of-week field" || fail "cron cadence is plumbed" "$r_cron_w"
printf '%s' "$r_cron_w" | grep -qF 'CATALYST_WORKTREE_STALE_DAYS=30' && ok "cron: the window is exported on the scheduled line" || fail "cron retention is plumbed" "$r_cron_w"
cron_w_lines="$(printf '%s' "$r_cron_w" | sed -n '/# BEGIN catalyst-prune-worktrees/,/# END catalyst-prune-worktrees/p' | sed '1d;$d' | grep -c .)"
[ "$cron_w_lines" = 1 ] && ok "cron: still exactly one line between BEGIN/END" || fail "cron block is one line" "$cron_w_lines"

# C7 — the cron line creates its log directory before the append redirect, and follows
# CATALYST_LOGS_DIR. A `>>` redirect is evaluated BEFORE the command execs, so a line that only
# redirects dies on every run on a host where the directory does not exist yet.
printf '%s' "$r_cron_w" | grep -qE 'mkdir -p "[^"]+/prune-worktrees" && .*prune-worktrees\.sh --apply >>' \
  && ok "C7: the cron line creates its log directory before redirecting into it" || fail "C7: cron log directory is created" "$r_cron_w"
r_cron_logs="$(CATALYST_LOGS_DIR=/var/log/catalyst bash "${SKILL_DIR}/scripts/install-schedule.sh" --render cron)"
printf '%s' "$r_cron_logs" | grep -qF '/var/log/catalyst/prune-worktrees/cron.log' \
  && ok "C7: the cron line honours CATALYST_LOGS_DIR instead of hard-coding the XDG default" || fail "C7: cron honours CATALYST_LOGS_DIR" "$r_cron_logs"

# the recorded answer, with no flags at all — this is what made accepting mean something
PLUMB_CFG="${SCRATCH}/plumb-housekeeping.json"
PLUMB_STAGE="${SCRATCH}/plumb-stage"
CATALYST_PRUNE_CONFIG="$PLUMB_CFG" bash "${SKILL_DIR}/scripts/offer-schedule.sh" \
  --accept --schedule weekly --retention-days 30 --root "$PLUMB_STAGE" >/dev/null 2>&1
r_recorded="$(CATALYST_PRUNE_CONFIG="$PLUMB_CFG" bash "${SKILL_DIR}/scripts/install-schedule.sh" --render systemd)"
if printf '%s' "$r_recorded" | grep -qF 'OnCalendar=weekly' \
  && printf '%s' "$r_recorded" | grep -qF 'Environment=CATALYST_WORKTREE_STALE_DAYS=30'; then
  ok "M1: with no flags, the installer renders the answer recorded in housekeeping.json"
else
  fail "M1: the recorded answer drives the rendered unit" "$r_recorded"
fi
staged_all="$(cat "${PLUMB_STAGE}/systemd/user/catalyst-prune-worktrees.timer" \
  "${PLUMB_STAGE}/systemd/user/catalyst-prune-worktrees.service" \
  "${PLUMB_STAGE}/Library/LaunchAgents/dev.catalyst.prune-worktrees.plist" \
  "${PLUMB_STAGE}/crontab-block" 2>/dev/null)"
if printf '%s' "$staged_all" | grep -qE 'CATALYST_WORKTREE_STALE_DAYS=30|<string>30</string>' \
  && printf '%s' "$staged_all" | grep -qE 'OnCalendar=weekly|<key>Weekday</key>|3 \* \* 0'; then
  ok "M1: --accept --schedule weekly --retention-days 30 stages a unit carrying both"
else
  fail "M1: the accepted answer reaches the staged unit" "$staged_all"
fi
# control: accepting the defaults stages a daily unit — the assertion above tracks the answer
PLUMB_CFG2="${SCRATCH}/plumb-housekeeping-2.json"
PLUMB_STAGE2="${SCRATCH}/plumb-stage-2"
CATALYST_PRUNE_CONFIG="$PLUMB_CFG2" bash "${SKILL_DIR}/scripts/offer-schedule.sh" \
  --accept --root "$PLUMB_STAGE2" >/dev/null 2>&1
staged_all2="$(cat "${PLUMB_STAGE2}/systemd/user/catalyst-prune-worktrees.timer" \
  "${PLUMB_STAGE2}/systemd/user/catalyst-prune-worktrees.service" \
  "${PLUMB_STAGE2}/Library/LaunchAgents/dev.catalyst.prune-worktrees.plist" \
  "${PLUMB_STAGE2}/crontab-block" 2>/dev/null)"
if printf '%s' "$staged_all2" | grep -qE 'CATALYST_WORKTREE_STALE_DAYS=14|<string>14</string>' \
  && ! printf '%s' "$staged_all2" | grep -qF 'OnCalendar=weekly'; then
  ok "control: accepting the defaults stages the daily/14-day form, not the weekly/30 one"
else
  fail "control: default answer stages the default form" "$staged_all2"
fi

# ── C2: a write the script could not build must leave the operator's config alone ────────────
echo ""
echo "offer-schedule.sh refuses rather than truncating (C2)"

C2CFG="${SCRATCH}/c2-cfg.json"
printf '{"other":{"keep":"me"}}\n' > "$C2CFG"
out_c2="$(CATALYST_PRUNE_CONFIG="$C2CFG" bash "${SKILL_DIR}/scripts/offer-schedule.sh" --decline --retention-days "" 2>&1)"; rc_c2=$?
if [ "$rc_c2" -ne 0 ] && jq -e '.other.keep == "me"' "$C2CFG" >/dev/null 2>&1 \
  && ! jq -e 'has("housekeeping")' "$C2CFG" >/dev/null 2>&1; then
  ok "C2: an empty --retention-days refuses, and the unrelated key is still there"
else
  fail "C2: a bad --retention-days must not touch the config" "rc=$rc_c2 out=$out_c2 cfg=$(cat "$C2CFG")"
fi
out_c2b="$(CATALYST_PRUNE_CONFIG="$C2CFG" bash "${SKILL_DIR}/scripts/offer-schedule.sh" --decline --schedule hourly 2>&1)"; rc_c2b=$?
if [ "$rc_c2b" -ne 0 ] && jq -e '.other.keep == "me"' "$C2CFG" >/dev/null 2>&1; then
  ok "C2: an unsupported --schedule refuses, and the config is untouched"
else
  fail "C2: a bad --schedule must not touch the config" "rc=$rc_c2b out=$out_c2b"
fi
JQSTUB="${SCRATCH}/jq-stub"
mkdir -p "$JQSTUB"
printf '#!/usr/bin/env bash\nexit 1\n' > "${JQSTUB}/jq"; chmod +x "${JQSTUB}/jq"
before_c2="$(cat "$C2CFG")"
out_c2c="$(PATH="${JQSTUB}:${PATH}" CATALYST_PRUNE_CONFIG="$C2CFG" bash "${SKILL_DIR}/scripts/offer-schedule.sh" --decline 2>&1)"; rc_c2c=$?
if [ "$rc_c2c" -ne 0 ] && [ "$(cat "$C2CFG")" = "$before_c2" ] && [ -s "$C2CFG" ]; then
  ok "C2: a failing jq refuses and leaves the config byte-identical, never an empty file"
else
  fail "C2: a failing jq must not truncate the config" "rc=$rc_c2c out=$out_c2c cfg=$(cat "$C2CFG")"
fi
# control: the same command with a working jq DOES record the answer
CATALYST_PRUNE_CONFIG="$C2CFG" bash "${SKILL_DIR}/scripts/offer-schedule.sh" --decline >/dev/null 2>&1
if jq -e '.housekeeping.answer == "decline" and .other.keep == "me"' "$C2CFG" >/dev/null 2>&1; then
  ok "control: with a working jq the same call records the answer and keeps the unrelated key"
else
  fail "control: a normal decline still records" "$(cat "$C2CFG")"
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
