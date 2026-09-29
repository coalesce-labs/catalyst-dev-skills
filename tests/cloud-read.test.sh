#!/usr/bin/env bash
# cloud-read.test.sh — a machine connected to a cloud account reads Linear through the catalyst
# CLI, and a failed cloud read is reported, never rerouted to direct Linear.
#
# Run: bash tests/cloud-read.test.sh
#
# The operator path (the replica helper, then linearis) is for a machine with no cloud connection
# at all: no `catalyst login` session and no key. A missing catalyst binary uses the npx form.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$ROOT/vendor-src/scripts/lib/catalyst-cloud-read.sh"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "── catalyst-cloud-read.sh"
[[ -f "$LIB" ]] || { bad "vendor-src/scripts/lib/catalyst-cloud-read.sh exists"; echo "cloud-read.test.sh: $PASS passed, $FAIL failed"; exit 1; }

# The helper sources its sibling replica helper; a stub stands in for it and logs every call.
mkdir -p "$TMP/lib" "$TMP/bin" "$TMP/nobin"
cp "$LIB" "$TMP/lib/"
cat >"$TMP/lib/linear-read-replica.sh" <<'STUB'
linear_read_ticket() { echo "replica $*" >>"$LOG"; echo '{"title":"from the replica"}'; }
STUB
cat >"$TMP/bin/catalyst" <<'STUB'
#!/usr/bin/env bash
echo "catalyst $*" >>"$LOG"
[[ "${CLI_FAIL:-}" == 1 ]] && { echo "catalyst: 401 unauthorized" >&2; exit 1; }
echo '{"title":"from the cloud"}'
STUB
cat >"$TMP/nobin/npx" <<'STUB'
#!/usr/bin/env bash
echo "npx $*" >>"$LOG"
echo '{"title":"from npx"}'
STUB
chmod +x "$TMP/bin/catalyst" "$TMP/nobin/npx"

read_ticket() { # read_ticket <home> <path-dir> -> stdout of the read; exit status in $rc
  : >"$TMP/log"
  out=$(HOME="$1" LOG="$TMP/log" PATH="$2:/usr/bin:/bin" XDG_CONFIG_HOME="" CLI_FAIL="${CLI_FAIL:-}" \
    CATALYST_CLOUD_TOKEN="${TOKEN:-}" bash -c '. "$0"; catalyst_ticket_json ENG-1' "$TMP/lib/catalyst-cloud-read.sh" 2>"$TMP/err")
  rc=$?
}

mkdir -p "$TMP/connected/.config/catalyst-cloud" "$TMP/offcloud"
echo '{}' >"$TMP/connected/.config/catalyst-cloud/customer.json"
PATH_WITH_CLI="$TMP/bin"
PATH_WITH_NPX="$TMP/nobin"

read_ticket "$TMP/connected" "$PATH_WITH_CLI"
[[ "$out" == *"from the cloud"* ]] && ! grep -q replica "$TMP/log" && ok "a connected machine reads through the catalyst CLI" || bad "a connected machine reads through the catalyst CLI"

CLI_FAIL=1 read_ticket "$TMP/connected" "$PATH_WITH_CLI"
if grep -q replica "$TMP/log"; then bad "a failed cloud read never falls through to the replica helper"; else ok "a failed cloud read never falls through to the replica helper"; fi
[[ "$rc" -ne 0 ]] && ok "a failed cloud read fails the call" || bad "a failed cloud read fails the call"
grep -q "401 unauthorized" "$TMP/err" && grep -q "catalyst ready" "$TMP/err" && ok "a failed cloud read shows the cloud's error and the repair step" || bad "a failed cloud read shows the cloud's error and the repair step"

read_ticket "$TMP/connected" "$PATH_WITH_NPX"
grep -q "npx .*-p @catalyst-cloud/cli catalyst query issue ENG-1" "$TMP/log" && ! grep -q replica "$TMP/log" && ok "a connected machine without the binary uses the npx form" || bad "a connected machine without the binary uses the npx form"

TOKEN=key read_ticket "$TMP/offcloud" "$PATH_WITH_CLI"
[[ "$out" == *"from the cloud"* ]] && ok "a key in CATALYST_CLOUD_TOKEN counts as connected" || bad "a key in CATALYST_CLOUD_TOKEN counts as connected"

read_ticket "$TMP/offcloud" "$PATH_WITH_CLI"
grep -q "replica ENG-1" "$TMP/log" && ! grep -q "^catalyst" "$TMP/log" && ok "a machine with no cloud connection takes the operator path" || bad "a machine with no cloud connection takes the operator path"

echo "── call sites use the helper"
grep -q "catalyst_ticket_json" "$ROOT/skills/describe-pr/references/merge-and-title.md" && ok "describe-pr reads the ticket with catalyst_ticket_json" || bad "describe-pr reads the ticket with catalyst_ticket_json"
grep -q "catalyst_ticket_json" "$ROOT/vendor-src/scripts/compound-log.sh" && ok "compound-log reads the estimate with catalyst_ticket_json" || bad "compound-log reads the estimate with catalyst_ticket_json"
grep -q "catalyst_ticket_json" "$ROOT/skills/gherkin-ticket/SKILL.md" && ok "gherkin-ticket reads the ticket with catalyst_ticket_json" || bad "gherkin-ticket reads the ticket with catalyst_ticket_json"
for f in "$ROOT/skills/describe-pr/references/merge-and-title.md" "$ROOT/vendor-src/scripts/compound-log.sh"; do
  grep -qE 'catalyst query issue[^|]*2>/dev/null' "$f" && bad "$(basename "$f") hides a cloud read's error" || ok "$(basename "$f") keeps a cloud read's error visible"
done

echo "cloud-read.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
