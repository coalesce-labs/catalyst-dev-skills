#!/usr/bin/env bash
# pr-description-file.test.sh — describe-pr saves a PR's description as a dated ticket file
# (`YYYY-MM-DD-<TICKET>-pr-<number>.md`), and every reader finds that PR's file by its number,
# falling back to the older `<number>_description.md` name.
#
# The lookup lines are EXTRACTED from the skill references and RUN against a scratch thoughts
# tree, under bash and zsh (the agent's Bash tool runs zsh on macOS).
#
# Run: bash tests/pr-description-file.test.sh
# Bash-3.2 safe.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$(cd "${SCRIPT_DIR}/../skills" && pwd)"
WRITER="${SKILLS_DIR}/describe-pr/references/verify-and-writeback.md"
READERS="${SKILLS_DIR}/describe-pr/references/process.md ${SKILLS_DIR}/merge-pr/references/post-merge.md"

PASS=0
FAIL=0
ok()   { PASS=$((PASS+1)); printf '  PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  FAIL: %s\n    %s\n' "$1" "${2:-}"; }

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

echo "describe-pr's saved description file"
grep -E '^(pr_file=|\[\[ -n "\$pr_file" \]\])' "$WRITER" > "${SCRATCH}/writer.sh"
lookup="$(head -2 "${SCRATCH}/writer.sh")"
if [ "$(wc -l < "${SCRATCH}/writer.sh" | tr -d ' ')" -eq 3 ]; then
  ok "the writer carries the lookup and the new-file name"
else
  fail "the writer carries the lookup and the new-file name" "found: $(cat "${SCRATCH}/writer.sh")"
fi
for reader in $READERS; do
  name="${reader#"${SKILLS_DIR}/"}"
  if [ "$(grep -E '^(pr_file=|\[\[ -n "\$pr_file" \]\])' "$reader")" = "$lookup" ]; then
    ok "${name} looks the PR's file up exactly as the writer does"
  else
    fail "${name} looks the PR's file up exactly as the writer does" "lookup differs or is missing"
  fi
done

# resolve <shell> <tree> <pr_number> <ticket> → the file the writer would write
resolve() {
  (cd "$2" && env pr_number="$3" ticket="$4" "$1" -c ". '${SCRATCH}/writer.sh'; printf '%s' \"\$pr_file\"")
}

SHELLS="bash"
command -v zsh >/dev/null 2>&1 && SHELLS="bash zsh"
today="$(date -u +%Y-%m-%d)"
for sh in $SHELLS; do
  tree="${SCRATCH}/tree-${sh}"
  mkdir -p "${tree}/thoughts/shared/prs"
  got="$(resolve "$sh" "$tree" 123 ABC-1)"
  [ "$got" = "thoughts/shared/prs/${today}-ABC-1-pr-123.md" ] \
    && ok "[${sh}] a first description is a dated file named for the ticket and PR" \
    || fail "[${sh}] a first description is a dated file named for the ticket and PR" "got '${got}'"

  got="$(resolve "$sh" "$tree" 123 "")"
  [ "$got" = "thoughts/shared/prs/${today}-pr-123.md" ] \
    && ok "[${sh}] with no ticket the name carries only the PR" \
    || fail "[${sh}] with no ticket the name carries only the PR" "got '${got}'"

  printf 'x\n' > "${tree}/thoughts/shared/prs/123_description.md"
  got="$(resolve "$sh" "$tree" 123 ABC-1)"
  [ "$got" = "thoughts/shared/prs/123_description.md" ] \
    && ok "[${sh}] a description saved under the older name is updated in place" \
    || fail "[${sh}] a description saved under the older name is updated in place" "got '${got}'"

  printf 'x\n' > "${tree}/thoughts/shared/prs/2026-01-01-ABC-1-pr-123.md"
  printf 'x\n' > "${tree}/thoughts/shared/prs/2026-01-02-ABC-9-pr-1123.md"
  got="$(resolve "$sh" "$tree" 123 ABC-1)"
  [ "$got" = "thoughts/shared/prs/2026-01-01-ABC-1-pr-123.md" ] \
    && ok "[${sh}] an update rewrites the PR's dated file, never another PR's" \
    || fail "[${sh}] an update rewrites the PR's dated file, never another PR's" "got '${got}'"
done

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
