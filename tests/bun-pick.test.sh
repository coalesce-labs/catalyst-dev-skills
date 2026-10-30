#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S="$(mktemp -d)"
trap 'rm -rf "$S"' EXIT
PASS=0 FAIL=0
# check <name> <status> — each case's assertions run as plain shell on the line just
# above its check call, and the status of that assertion line is passed in. No eval,
# so shellcheck checks every assertion where it is written.
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS+1)); echo "PASS: $1"; else FAIL=$((FAIL+1)); echo "FAIL: $1"; fi; }
if [ ! -f "$ROOT/vendor-src/scripts/lib/bun-pick.sh" ]; then echo 'FAIL: missing bun-pick.sh'; exit 1; fi
source "$ROOT/vendor-src/scripts/lib/bun-pick.sh"
mkbun() { mkdir -p "$S/$1"; printf '#!/bin/sh\necho "%s"\n' "$2" > "$S/$1/bun"; chmod +x "$S/$1/bun"; }
mkbun old 1.3.11
mkbun new 1.4.2
mkbun newer 1.4.4
mkbun canary 1.4.3-canary.abc
mkbun junk junk
mkbun nine 1.9.0
mkbun ten 1.10.0
pick() { PATH="$1:/usr/bin:/bin" catalyst_bun_pick "$2"; }
[ "$(catalyst_bun_declared_version bun@1.4.2)" = 1.4.2 ]
r=$?; check 'declared, plain' "$r"
[ "$(catalyst_bun_declared_version bun@1.4.2+sha512.abc)" = 1.4.2 ]
r=$?; check 'declared, integrity suffix' "$r"
! catalyst_bun_declared_version pnpm@9.0.0 && [ -z "$(catalyst_bun_declared_version pnpm@9.0.0)" ]
r=$?; check 'declared, another manager' "$r"
! catalyst_bun_declared_version bun@detected
r=$?; check 'declared, text-sniff marker' "$r"
! catalyst_bun_declared_version 'bun@^1.4' && ! catalyst_bun_declared_version bun@latest
r=$?; check 'declared, range or tag' "$r"
[ "$(catalyst_bun_version "$S/canary/bun")" = 1.4.3 ]
r=$?; check 'version, canary' "$r"
! catalyst_bun_version "$S/junk/bun" && ! catalyst_bun_version "$S/missing"
r=$?; check 'version, junk or missing' "$r"
catalyst_semver_lt 1.3.11 1.4.2 && catalyst_semver_lt 1.9.0 1.10.0 && ! catalyst_semver_lt 1.4.2 1.4.2 && ! catalyst_semver_lt 1.4.4 1.4.2
r=$?; check 'compare' "$r"
pick "$S/old:$S/new" 1.4.2 && [ "$BUN_PICK" = "$S/new/bun" ] && [ "$BUN_PICK_VERSION" = 1.4.2 ] && [ "$BUN_PICK_FIRST" = "$S/old/bun" ] && [ "$BUN_PICK_FIRST_VERSION" = 1.3.11 ]
r=$?; check 'older first, declared later' "$r"
pick "$S/old:$S/newer:$S/new" 1.4.2 && [ "$BUN_PICK" = "$S/new/bun" ]
r=$?; check 'exact preferred over newer' "$r"
pick "$S/old:$S/newer" 1.4.2 && [ "$BUN_PICK" = "$S/newer/bun" ]
r=$?; check 'newer when no exact' "$r"
pick "$S/newer:$S/new" 1.4.2 && [ "$BUN_PICK" = "$S/newer/bun" ]
r=$?; check 'first newer is kept' "$r"
! pick "$S/old" 1.4.2 && [ "$BUN_PICK" = "$S/old/bun" ]
r=$?; check 'only older' "$r"
pick "$S/junk:$S/new" 1.4.2 && [ "$BUN_PICK" = "$S/junk/bun" ]
r=$?; check 'unreadable first is kept' "$r"
pick "$S/nine:$S/ten" 1.10.0 && [ "$BUN_PICK" = "$S/ten/bun" ]
r=$?; check 'numeric not lexical' "$r"
! pick "$S/old:$S/old" 1.4.2
r=$?; check 'duplicate PATH entry' "$r"
(cd "$S" && PATH="old:new:/usr/bin:/bin" catalyst_bun_pick 1.4.2 && [ "$BUN_PICK_FIRST" = "$S/old/bun" ] && [ "$BUN_PICK" = "$S/new/bun" ])
r=$?; check 'relative PATH entries' "$r"
d=$(catalyst_bun_shim_dir "$S/new/bun") && [ "$("$d/bun" --version)" = 1.4.2 ] && [ -L "$d/bunx" ] && [ "$(cd "$d" && printf '%s ' *)" = "bun bunx " ]
r=$?; rm -rf "${d:-}"; check 'shim' "$r"
mkdir -p "$S/tmp"
d=$(TMPDIR="$S/tmp" catalyst_bun_shim_dir "$S/new/bun") && [[ "$d" == "$S/tmp/"* ]]
r=$?; rm -rf "${d:-}"; check 'shim under TMPDIR' "$r"
! grep -vE '^[[:space:]]*#' "$ROOT/vendor-src/scripts/lib/bun-pick.sh" | grep -nE 'declare -A|mapfile|readarray|,,|\^\^'
r=$?; check 'bash 3.2 subset' "$r"
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
