#!/usr/bin/env bash
# run-tests.sh — every test in tests/: the bun suites, then each shell suite. Exits non-zero if
# any one of them failed, naming it; one failure does not hide the others.
#
# Run: bash scripts/run-tests.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

failed=""
echo "── bun test tests/"
bun test tests/ || failed="$failed bun-test"

ran=0
for t in tests/*.test.sh; do
  [ -f "$t" ] || continue
  ran=$((ran+1))
  echo "── bash $t"
  bash "$t" || failed="$failed $t"
done
[ "$ran" -gt 0 ] || failed="$failed (no-shell-suites-found)"

echo ""
if [ -z "$failed" ]; then
  echo "all test suites passed (bun + $ran shell)"
else
  echo "FAILED:$failed"
  exit 1
fi
