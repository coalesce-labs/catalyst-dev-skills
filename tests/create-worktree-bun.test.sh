#!/usr/bin/env bash
# The bun install path, with no real bun on the fixture PATH.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CW="$ROOT/vendor-src/scripts/create-worktree.sh"
S="$(mktemp -d)"
trap 'rm -rf "$S"' EXIT
PASS=0 FAIL=0
q="'"
check() { if eval "$2"; then PASS=$((PASS+1)); echo "PASS: $1"; else FAIL=$((FAIL+1)); echo "FAIL: $1"; cat "$S/last.log"; fi; }
command -v jq >/dev/null || { echo 'suite needs jq'; exit 1; }
mkdir -p "$S/tools" "$S/home/.config/humanlayer" "$S/thoughts" "$S/tmp"
for tool in git jq; do ln -s "$(command -v "$tool")" "$S/tools/$tool"; done
printf '#!/bin/sh\nexit 0\n' > "$S/tools/humanlayer"
printf '#!/bin/sh\nexit 1\n' > "$S/tools/lsof-no-holders"
chmod +x "$S/tools/humanlayer" "$S/tools/lsof-no-holders"
printf '{"thoughts":{"thoughtsRepo":"%s","user":"t"}}\n' "$S/thoughts" > "$S/home/.config/humanlayer/humanlayer.json"
mkbun() {
  mkdir -p "$S/$1"
  cat > "$S/$1/bun" <<STUB
#!/bin/sh
case "\$1" in
 --version) echo "$2"; exit 0 ;;
 install) echo "$S/$1/bun \$*" >> "$S/install.log"; bun --version >> "$S/lifecycle.log"; exit $3 ;;
esac
exit 0
STUB
  chmod +x "$S/$1/bun"
}
mkbun old 1.3.11 1
mkbun new 1.4.2 0
mkbun newer 1.4.4 0
for fixture in lock nolock lockonly; do
  git init -q -b main "$S/$fixture"
  if [ "$fixture" = lockonly ]; then echo '{}' > "$S/$fixture/package.json"; else echo '{"packageManager":"bun@1.4.2"}' > "$S/$fixture/package.json"; fi
  [ "$fixture" = nolock ] || touch "$S/$fixture/bun.lock"
  git -C "$S/$fixture" add .
  git -C "$S/$fixture" -c user.email=t@t.t -c user.name=t commit -qm init
done
cw() {
  local fixture="$1" name="$2" bun_dirs="$3"
  : > "$S/install.log"; : > "$S/lifecycle.log"
  (cd "$S/$fixture" && env -i PATH="$bun_dirs:$S/tools:/usr/bin:/bin" HOME="$S/home" TMPDIR="$S/tmp" WT_GUARD_LSOF="$S/tools/lsof-no-holders" bash "$CW" "$name" main --skip-fetch --worktree-dir "$S/wt") > "$S/last.log" 2>&1
  rc=$?
}
contains() { grep -qF "$1" "$S/last.log"; }
cw lock E1 "$S/old:$S/new"
check 'E1: declared bun installs and lifecycle uses it; shim removed' '[ "$rc" -eq 0 ] && [ "$(cat "$S/install.log")" = "$S/new/bun install --frozen-lockfile" ] && [ "$(cat "$S/lifecycle.log")" = 1.4.2 ] && contains "bun 1.3.11 at $S/old/bun is older than package.json${q}s bun@1.4.2; installing with bun 1.4.2 at $S/new/bun" && contains "PATH still finds bun 1.3.11 first" && [ -d "$S/wt/E1" ] && git -C "$S/lock" show-ref --verify --quiet refs/heads/E1 && [ -z "$(find "$S/tmp" -name "catalyst-bun.*")" ]'
cw lock E2 "$S/old"
check 'E2: failure names versions and path, rolls tree and branch back' '[ "$rc" -eq 1 ] && contains "no bun on PATH is 1.4.2 or newer; trying it anyway" && contains "Setup failed: ${q}bun install --frozen-lockfile${q} exited 1 under bun 1.3.11 at $S/old/bun, and package.json declares bun@1.4.2. Install bun 1.4.2, or put it first on PATH, then create the worktree again" && contains "Cleaning up worktree" && [ ! -d "$S/wt/E2" ] && ! git -C "$S/lock" show-ref --verify --quiet refs/heads/E2'
mkbun old 1.3.11 0
cw lock E3 "$S/old"
check 'E3: older bun may succeed' '[ "$rc" -eq 0 ] && contains "trying it anyway" && [ "$(cat "$S/install.log")" = "$S/old/bun install --frozen-lockfile" ] && [ -d "$S/wt/E3" ]'
cw lock E4 "$S/newer:$S/new"
check 'E4: first newer kept quietly' '[ "$rc" -eq 0 ] && [ "$(cat "$S/install.log")" = "$S/newer/bun install --frozen-lockfile" ] && ! contains "is older than"'
mkbun new 1.4.2 3
cw lock E5 "$S/new"
check 'E5: matching bun failure names actual exit code' '[ "$rc" -eq 1 ] && contains "Setup failed: ${q}bun install --frozen-lockfile${q} exited 3 under bun 1.4.2 at $S/new/bun" && ! contains "declares bun@"'
mkbun new 1.4.2 0
mkbun old 1.3.11 1
cw nolock E6 "$S/old:$S/new"
check 'E6: no lockfile uses plain install' '[ "$rc" -eq 0 ] && [ "$(cat "$S/install.log")" = "$S/new/bun install" ]'
mkbun old 1.3.11 0
cw lockonly E7 "$S/old:$S/new"
check 'E7: no declared version keeps first bun' '[ "$rc" -eq 0 ] && [ "$(cat "$S/install.log")" = "$S/old/bun install --frozen-lockfile" ] && ! contains "is older than"'
mkbun old 1.3.11 1
cw lock E8 "$S/old:$S/newer:$S/new"
check 'E8: exact preferred over newer' '[ "$rc" -eq 0 ] && [ "$(cat "$S/install.log")" = "$S/new/bun install --frozen-lockfile" ]'
cp -R "$ROOT/vendor-src/scripts" "$S/scripts"
rm "$S/scripts/lib/bun-pick.sh"
CW="$S/scripts/create-worktree.sh"
mkbun old 1.3.11 0
cw lock E9 "$S/old:$S/new"
check 'E9: absent library preserves first bun' '[ "$rc" -eq 0 ] && [ "$(cat "$S/install.log")" = "$S/old/bun install --frozen-lockfile" ] && ! contains "is older than"'
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
