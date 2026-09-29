#!/usr/bin/env bash
# linear-write-guards.test.sh — research-codebase's Linear write is guarded IN THE STEP, not only in
# a trailing section.
#
# WHY: a phase container holds no Linear credential and its prompt forbids linearis. A model
# following the numbered steps reaches the step's own instruction before any trailing
# `## Linear Integration` section, so the step that posts the research-complete comment (8b) must
# itself say to skip when CATALYST_PHASE is set and to skip silently when no tool is available.
# The coding skills write no ticket state at all; tests/ticket-moves.test.mjs holds that rule.
#
# Run: bash tests/linear-write-guards.test.sh
# Bash-3.2 safe.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$(cd "${SCRIPT_DIR}/../skills" && pwd)"
RESEARCH="${SKILLS_DIR}/research-codebase/SKILL.md"

PASS=0
FAIL=0
ok()   { PASS=$((PASS+1)); printf '  PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  FAIL: %s\n    %s\n' "$1" "${2:-}"; }

[ -f "$RESEARCH" ] || { echo "FATAL: subject not found: $RESEARCH" >&2; exit 1; }

# guard_problem <line> → prints what the line is missing; prints nothing when it is guarded.
# The step is ONE markdown line (a bullet or a bold sub-step); both guards must be on that same
# line so they cannot drift apart from the instruction.
guard_problem() {
  case "$1" in
    *CATALYST_PHASE*) ;;
    *) echo "the step does not skip when CATALYST_PHASE is set"; return ;;
  esac
  case "$1" in
    *"skip silently"*) ;;
    *) echo "the step does not skip silently when no Linear tool is available" ;;
  esac
}

# assert_guarded <label> <file> <fixed-string that identifies the step line>
assert_guarded() {
  local label="$1" file="$2" anchor="$3" line problem
  line="$(grep -F -- "$anchor" "$file" | head -1)"
  if [ -z "$line" ]; then
    fail "$label" "no line contains the anchor: $anchor"
    return
  fi
  problem="$(guard_problem "$line")"
  if [ -z "$problem" ]; then ok "$label"; else fail "$label" "${problem}: ${line:0:160}"; fi
}

echo "Linear write steps carry their own guards"

# Controls: the probe passes a guarded step and names what an unguarded one lacks.
if [ -z "$(guard_problem '**8b.** Comment. Skip this when `CATALYST_PHASE` is set; if no tool is available, skip silently.')" ]; then
  ok "control: a step carrying both guards passes"
else
  fail "control: a step carrying both guards passes" "the probe rejected a guarded line"
fi
case "$(guard_problem '**8b.** Comment on the ticket with linearis.')" in
  *CATALYST_PHASE*) ok "control: a step with no guard is caught" ;;
  *) fail "control: a step with no guard is caught" "the probe accepted an unguarded line" ;;
esac
case "$(guard_problem '**8b.** Comment. Skip this when `CATALYST_PHASE` is set.')" in
  *"skip silently"*) ok "control: a step missing the no-tool skip is caught" ;;
  *) fail "control: a step missing the no-tool skip is caught" "the probe accepted a half-guarded line" ;;
esac

assert_guarded "research-codebase: the research-complete comment (8b) is guarded in-step" \
  "$RESEARCH" '**8b. Linear comment**'

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
