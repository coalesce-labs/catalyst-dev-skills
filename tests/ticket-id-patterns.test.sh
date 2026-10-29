#!/usr/bin/env bash
# Ticket extraction supports team keys with digits. Bash-3.2 safe.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0
ok() { PASS=$((PASS+1)); printf '  PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  FAIL: %s\n    %s\n' "$1" "${2:-}"; }

if hits="$(grep -rlF '[A-Z]+-[0-9]+' "$REPO_ROOT/skills" "$REPO_ROOT/vendor-src")"; then
  fail "no letters-only ticket pattern remains" "$hits"
else
  result=$?
  if [ "$result" -eq 1 ]; then
    ok "no letters-only ticket pattern remains"
  else
    fail "ticket pattern scan completed" "grep exited $result"
  fi
fi

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
SHELLS="bash"
command -v zsh >/dev/null 2>&1 && SHELLS="bash zsh"

# Pass arguments to the child shell verbatim, without evaluating input as code.
check() {
  local label="$1" expected="$2" got result
  shift 2
  got="$(env XDG_CONFIG_HOME="$SCRATCH" "$sh" -c 'source "$1"; shift; "$@"' test "$helper" "$@")"
  result=$?
  if [ "$result" -eq 0 ] && [ "$got" = "$expected" ]; then
    ok "$copy [$sh]: $label"
  else
    fail "$copy [$sh]: $label" "exit $result; expected '$expected', got '$got'"
  fi
}

for copy in vendor-src/scripts/lib skills/create-pr/scripts/lib skills/describe-pr/scripts/lib; do
  helper="$REPO_ROOT/$copy/linear-pr-skip.sh"
  for sh in $SHELLS; do
    check "digit-key branch" "ABC2-17" linear_foreign_tokens_from_branch ABC2-17
    check "digit-key sibling recovery" "$(printf 'ABC2-1155\nABC2-1156')" linear_foreign_tokens_from_branch o-abc2-1155-1156
    check "mixed segment alone fabricates no ticket" "" linear_foreign_tokens_from_branch fix-oauth2-callback
    check "alphabetic sibling control" "$(printf 'ADV-1155\nADV-1156\nADV-1157')" linear_foreign_tokens_from_branch o-adv-1155-1156-1157-ADV-1155
    check "digit-key body" "ABC2-17" linear_foreign_tokens_from_body 'see ABC2-17'
    check "body prose fabricates no ticket" "" linear_foreign_tokens_from_body 'Released 2026-05-25, fixes utf8, abc123, api-v2, 075e1ff5'
    check "own digit-key ticket is not skipped" "" linear_sibling_skip_block_from_branch ABC2-17 ABC2-17
  done
done

printf '\nPASS: %s  FAIL: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
