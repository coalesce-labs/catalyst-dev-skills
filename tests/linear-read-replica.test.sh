#!/usr/bin/env bash
# linear-read-replica.test.sh — the vendored replica reader finds the Catalyst Cloud replica.
#
# The replica now lives at ~/.config/catalyst-cloud/replica.db (written by
# `catalyst-skills replica start`), not the retired ~/catalyst/catalyst-replica.db. Its
# freshness gate accepts a change-feed cursor from either `sync_cursors` or the
# `sync_meta` 'cursor' row, and still refuses a replica with neither (positive control).
#
# Run: bash tests/linear-read-replica.test.sh
# Bash-3.2 safe.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$(cd "${SCRIPT_DIR}/.." && pwd)/vendor-src/scripts/lib/linear-read-replica.sh"

PASS=0
FAIL=0
ok()   { PASS=$((PASS+1)); printf '  PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  FAIL: %s\n    %s\n' "$1" "${2:-}"; }

command -v sqlite3 >/dev/null 2>&1 || { echo "FATAL: sqlite3 is required for this test" >&2; exit 1; }
[ -f "$HELPER" ] || { echo "FATAL: helper not found: $HELPER" >&2; exit 1; }

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# make_db <path> <sync_cursors cursor|""> <sync_meta cursor|""> — a replica with the two cursor
# tables and a writer lock touched now.
make_db() {
  local db="$1" sc="$2" sm="$3"
  mkdir -p "$(dirname "$db")"
  sqlite3 "$db" "CREATE TABLE sync_cursors (source text NOT NULL, entity text NOT NULL, cursor text, last_run_at integer, PRIMARY KEY(source, entity));
                 CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT);
                 INSERT INTO sync_meta VALUES ('account', 'acct');"
  [ -n "$sc" ] && sqlite3 "$db" "INSERT INTO sync_cursors VALUES ('linear', 'issues', '$sc', 0);"
  [ -n "$sm" ] && sqlite3 "$db" "INSERT INTO sync_meta VALUES ('cursor', '$sm');"
  printf '{"pid":1,"heartbeat":0}\n' > "$db.writer.lock"
}

# in_env <home> <command> — sources the helper in a clean shell with that HOME.
in_env() {
  env -u CATALYST_REPLICA_DB HOME="$1" CATALYST_DIR="$1/legacy-catalyst" bash -c "source '$HELPER'; $2"
}

echo "linear-read-replica: default path and freshness gate"

HOME1="$SCRATCH/home1"
got="$(in_env "$HOME1" 'printf %s "$CATALYST_REPLICA_DB"')"
if [ "$got" = "$HOME1/.config/catalyst-cloud/replica.db" ]; then
  ok "the default replica path is ~/.config/catalyst-cloud/replica.db (CATALYST_DIR does not move it)"
else
  fail "the default replica path is ~/.config/catalyst-cloud/replica.db (CATALYST_DIR does not move it)" "got: $got"
fi

got="$(env HOME="$HOME1" CATALYST_REPLICA_DB="$SCRATCH/explicit.db" bash -c "source '$HELPER'; printf %s \"\$CATALYST_REPLICA_DB\"")"
if [ "$got" = "$SCRATCH/explicit.db" ]; then ok "CATALYST_REPLICA_DB still overrides the default"; else fail "CATALYST_REPLICA_DB still overrides the default" "got: $got"; fi

make_db "$HOME1/.config/catalyst-cloud/replica.db" "1643866" ""
if in_env "$HOME1" 'replica_fresh'; then ok "a fresh replica whose cursor is in sync_cursors is fresh (default path)"; else fail "a fresh replica whose cursor is in sync_cursors is fresh (default path)" "replica_fresh rc=1"; fi

HOME2="$SCRATCH/home2"
make_db "$HOME2/.config/catalyst-cloud/replica.db" "" "1643866"
if in_env "$HOME2" 'replica_fresh'; then ok "a fresh replica whose cursor is the sync_meta row is fresh"; else fail "a fresh replica whose cursor is the sync_meta row is fresh" "replica_fresh rc=1"; fi

HOME3="$SCRATCH/home3"
make_db "$HOME3/.config/catalyst-cloud/replica.db" "" ""
if in_env "$HOME3" 'replica_fresh'; then fail "control: a replica with no cursor anywhere is not fresh" "replica_fresh rc=0"; else ok "control: a replica with no cursor anywhere is not fresh"; fi

HOME4="$SCRATCH/home4"
make_db "$HOME4/.config/catalyst-cloud/replica.db" "1643866" ""
touch -t 200001010000 "$HOME4/.config/catalyst-cloud/replica.db.writer.lock"
if in_env "$HOME4" 'replica_fresh'; then fail "control: a stale writer heartbeat is not fresh" "replica_fresh rc=0"; else ok "control: a stale writer heartbeat is not fresh"; fi

HOME5="$SCRATCH/home5"
if in_env "$HOME5" 'replica_fresh'; then fail "control: an absent replica is not fresh" "replica_fresh rc=0"; else ok "control: an absent replica is not fresh"; fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
