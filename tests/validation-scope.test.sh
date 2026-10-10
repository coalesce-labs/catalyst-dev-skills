#!/usr/bin/env bash
# Contract tests for seat validation against moving main and declared plan deviations.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLAN="$ROOT/skills/create-plan/references/plan-template.md"
RESEARCH="$ROOT/skills/research-codebase/references/research-template.md"
HANDOFF="$ROOT/skills/create-handoff/SKILL.md"
IMPLEMENT="$ROOT/skills/implement-plan/SKILL.md"
DEVIATIONS="$ROOT/skills/implement-plan/references/deviations.md"
VALIDATE="$ROOT/skills/validate-plan/SKILL.md"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1"; }
contains() { grep -Eiq "$2" "$1"; }
for f in "$PLAN" "$RESEARCH" "$HANDOFF" "$IMPLEMENT" "$DEVIATIONS" "$VALIDATE"; do
  [ -f "$f" ] || { echo "missing test subject: $f" >&2; exit 1; }
done

# Positive control: prove the same grep instrument sees known text before interpreting misses.
if contains "$VALIDATE" 'Validation ladder block'; then ok 'control: validation skill text is readable'; else fail 'control: validation skill text is readable'; fi

# Scenario 1: each artifact carries a full source commit, branch and recorded main merge-base.
for f in "$PLAN" "$RESEARCH" "$HANDOFF" "$VALIDATE"; do
  if contains "$f" 'git_commit' && contains "$f" 'branch' && contains "$f" 'git_main_sha' && contains "$f" 'git_merge_base'; then
    ok "$(basename "$(dirname "$f")"): records commit, branch, main SHA and merge-base"
  else fail "$(basename "$(dirname "$f")"): records commit, branch, main SHA and merge-base"; fi
done
if contains "$PLAN" 'git rev-parse HEAD' && ! contains "$PLAN" 'GIT_COMMIT_SHORT'; then ok 'plan metadata uses a full commit SHA'; else fail 'plan metadata uses a full commit SHA'; fi

# Scenario 2: whole-branch validation uses the main SHA recorded at validation start.
if contains "$VALIDATE" 'git diff.*merge-base.*validation_main_sha.*HEAD' && contains "$VALIDATE" 'main SHA recorded at validation start'; then
  ok 'whole-branch validation diffs from the merge-base with recorded main'
else fail 'whole-branch validation diffs from the merge-base with recorded main'; fi
if contains "$VALIDATE" 'never.*live.*origin/main'; then ok 'validation does not use live origin/main'; else fail 'validation does not use live origin/main'; fi

# Scenario 3: repair validation is based on the exact failed head, not a moving merge-base.
if contains "$VALIDATE" 'repair.*exact prior failed head' && contains "$VALIDATE" 'never replace H1 with.*git merge-base'; then
  ok 'repair scope uses exact prior failed head and never merge-base'
else fail 'repair scope uses exact prior failed head and never merge-base'; fi
if contains "$VALIDATE" 'do not attribute its lines to the repair'; then
  ok 'main-only lines are excluded from repair findings'
else fail 'main-only lines are excluded from repair findings'; fi

# Scenario 4: main movement is a separate report, with affected planned files and commit named.
if contains "$VALIDATE" 'main movement.*separate section' && contains "$VALIDATE" 'git log.*plan.git_merge_base.*validation-main-sha'; then
  ok 'main movement is reported separately using plan base and recorded main'
else fail 'main movement is reported separately using plan base and recorded main'; fi
if contains "$VALIDATE" 'plan-referenced files' && contains "$VALIDATE" 'main commit'; then
  ok 'validation flags a plan-referenced file changed by a named main commit'
else fail 'validation flags a plan-referenced file changed by a named main commit'; fi

# Scenario 5: implement-plan writes the cloud-compatible deviation record and validate reads it.
if contains "$IMPLEMENT" 'deviations\.json' && contains "$DEVIATIONS" 'plan_ref.*planned.*actual.*reason.*evidence'; then
  ok 'implement-plan declares deviations in the shared JSON shape'
else fail 'implement-plan declares deviations in the shared JSON shape'; fi
if contains "$DEVIATIONS" 'full main commit SHA in `evidence`'; then
  ok 'deviation evidence records the full main commit that forced it'
else fail 'deviation evidence records the full main commit that forced it'; fi
if contains "$VALIDATE" 'deviations\.json' && contains "$VALIDATE" 'declared.*deviation'; then
  ok 'validate-plan reads and marks declared deviations'
else fail 'validate-plan reads and marks declared deviations'; fi

# Scenario 6: undeclared deviations are identified by file and line.
if contains "$VALIDATE" 'undeclared.*deviation' && contains "$VALIDATE" 'file.*line'; then
  ok 'validate-plan reports undeclared deviations with file and line'
else fail 'validate-plan reports undeclared deviations with file and line'; fi

printf '\nPASS: %s  FAIL: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
