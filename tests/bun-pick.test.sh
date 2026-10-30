#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S="$(mktemp -d)"
trap 'rm -rf "$S"' EXIT
PASS=0 FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "PASS: $1"; else FAIL=$((FAIL+1)); echo "FAIL: $1"; fi; }
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
check 'declared, plain' '[ "$(catalyst_bun_declared_version bun@1.4.2)" = 1.4.2 ]'
check 'declared, integrity suffix' '[ "$(catalyst_bun_declared_version bun@1.4.2+sha512.abc)" = 1.4.2 ]'
check 'declared, another manager' '! catalyst_bun_declared_version pnpm@9.0.0 && [ -z "$(catalyst_bun_declared_version pnpm@9.0.0)" ]'
check 'declared, text-sniff marker' '! catalyst_bun_declared_version bun@detected'
check 'declared, range or tag' '! catalyst_bun_declared_version bun@^1.4 && ! catalyst_bun_declared_version bun@latest'
check 'version, canary' '[ "$(catalyst_bun_version "$S/canary/bun")" = 1.4.3 ]'
check 'version, junk or missing' '! catalyst_bun_version "$S/junk/bun" && ! catalyst_bun_version "$S/missing"'
check 'compare' 'catalyst_semver_lt 1.3.11 1.4.2 && catalyst_semver_lt 1.9.0 1.10.0 && ! catalyst_semver_lt 1.4.2 1.4.2 && ! catalyst_semver_lt 1.4.4 1.4.2'
check 'older first, declared later' 'pick "$S/old:$S/new" 1.4.2 && [ "$BUN_PICK" = "$S/new/bun" ] && [ "$BUN_PICK_VERSION" = 1.4.2 ] && [ "$BUN_PICK_FIRST" = "$S/old/bun" ] && [ "$BUN_PICK_FIRST_VERSION" = 1.3.11 ]'
check 'exact preferred over newer' 'pick "$S/old:$S/newer:$S/new" 1.4.2 && [ "$BUN_PICK" = "$S/new/bun" ]'
check 'newer when no exact' 'pick "$S/old:$S/newer" 1.4.2 && [ "$BUN_PICK" = "$S/newer/bun" ]'
check 'first newer is kept' 'pick "$S/newer:$S/new" 1.4.2 && [ "$BUN_PICK" = "$S/newer/bun" ]'
check 'only older' '! pick "$S/old" 1.4.2 && [ "$BUN_PICK" = "$S/old/bun" ]'
check 'unreadable first is kept' 'pick "$S/junk:$S/new" 1.4.2 && [ "$BUN_PICK" = "$S/junk/bun" ]'
check 'numeric not lexical' 'pick "$S/nine:$S/ten" 1.10.0 && [ "$BUN_PICK" = "$S/ten/bun" ]'
check 'duplicate PATH entry' '! pick "$S/old:$S/old" 1.4.2'
check 'relative PATH entries' '(cd "$S" && PATH="old:new:/usr/bin:/bin" catalyst_bun_pick 1.4.2 && [ "$BUN_PICK_FIRST" = "$S/old/bun" ] && [ "$BUN_PICK" = "$S/new/bun" ])'
check 'shim' 'd=$(catalyst_bun_shim_dir "$S/new/bun") && [ "$("$d/bun" --version)" = 1.4.2 ] && [ -L "$d/bunx" ] && [ "$(ls "$d" | tr "\n" " ")" = "bun bunx " ]; rc=$?; rm -rf "${d:-}"; [ "$rc" -eq 0 ]'
mkdir -p "$S/tmp"
check 'shim under TMPDIR' 'd=$(TMPDIR="$S/tmp" catalyst_bun_shim_dir "$S/new/bun") && [[ "$d" == "$S/tmp/"* ]]; rc=$?; rm -rf "${d:-}"; [ "$rc" -eq 0 ]'
check 'bash 3.2 subset' '! grep -vE "^[[:space:]]*#" "$ROOT/vendor-src/scripts/lib/bun-pick.sh" | grep -nE "declare -A|mapfile|readarray|,,|\^\^"'
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
