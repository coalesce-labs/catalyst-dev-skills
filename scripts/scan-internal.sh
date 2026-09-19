#!/usr/bin/env bash
# scan-internal.sh — this repository is public; refuse internal values gitleaks does not look for.
#
# Patterns: a CATALYST_CLOUD_TOKEN assignment with a literal value, OpenAI-style `sk-` keys
# (anchored left, so an identifier that merely ends in `ask-`/`task-` is not a key),
# GitHub `ghp_`/`gho_` tokens, Linear `lin_api_` keys, private and CGNAT (Tailscale) IPv4
# addresses, and absolute home-directory paths. Prints file:line and the pattern name, never the
# matched value. A known, reviewed hit is listed in ALLOW as `<path>|<pattern name>`.
#
# Run: bash scripts/scan-internal.sh [--self-test]
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PATTERNS='cloud-token-value|CATALYST_CLOUD_TOKEN=[^[:space:]"'"'"'<$]
openai-key|(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}
github-token|gh[po]_[A-Za-z0-9]{16,}
linear-key|lin_api_[A-Za-z0-9]{16,}
private-ip-10|(^|[^0-9.])10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$)
private-ip-192|(^|[^0-9.])192\.168\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$)
private-ip-172|(^|[^0-9.])172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$)
cgnat-ip|(^|[^0-9.])100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$)
home-path|/(Users|home)/[a-z][a-z0-9_-]+/'

# Reviewed hits carried over from coalesce-labs/catalyst (already public there). Each is one
# vendored source and its copies, except create-handoff's `/Users/you/` placeholder.
ALLOW='scripts/execution-core/config.mjs|cgnat-ip
scripts/lib/comment-body-arg.mjs|home-path
skills/create-handoff/SKILL.md|home-path'

allowed() {
  local file="$1" name="$2" entry
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    case "/$file" in
      */"${entry%|*}") [ "$name" = "${entry#*|}" ] && return 0 ;;
    esac
  done <<EOF
$ALLOW
EOF
  return 1
}

# scan <dir> → prints one line per unallowed hit; returns the hit count as its output's line count.
scan() {
  local dir="$1" name regex loc
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    name="${line%%|*}"
    regex="${line#*|}"
    # /usr/bin/grep when present: an agent shell's `grep` may honour ignore files.
    while IFS= read -r loc; do
      [ -n "$loc" ] || continue
      allowed "${loc%%:*}" "$name" && continue
      printf '%s  %s\n' "$loc" "$name"
    done <<EOF
$("${GREP:-grep}" -rEno --exclude-dir=.git --exclude-dir=node_modules --exclude=scan-internal.sh "$regex" "$dir" 2>/dev/null | cut -d: -f1,2 | sed "s|^$dir/||" | sort -u)
EOF
  done <<EOF
$PATTERNS
EOF
}

[ -x /usr/bin/grep ] && GREP=/usr/bin/grep

if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  printf 'a 10.1.2.3 b\nhttp://100.65.1.2:80\n/Users/someone/x\nCATALYST_CLOUD_TOKEN=abc123\nversion 1.10.2.3\nOPENAI_API_KEY=sk-PLANTED_NOT_A_REAL_KEY\nthe ask-default-execution flag is shadow\n' > "$tmp/planted.txt"
  hits="$(scan "$tmp")"
  n="$(printf '%s\n' "$hits" | grep -c .)"
  if [ "$n" -eq 5 ]; then echo "scan-internal self-test: PASS (5 planted hits found; the version string and ask-default-execution ignored)"; exit 0; fi
  echo "scan-internal self-test: FAIL (expected 5 hits, got $n)"
  printf '%s\n' "$hits"
  exit 1
fi

hits="$(scan "$REPO_ROOT")"
if [ -z "$hits" ]; then
  echo "scan-internal: clean"
  exit 0
fi
echo "scan-internal: internal values found (file:line  pattern):"
printf '%s\n' "$hits"
exit 1
