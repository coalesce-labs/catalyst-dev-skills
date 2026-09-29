#!/usr/bin/env bash
# catalyst-cloud-read.sh — read a Linear ticket the way this machine is set up to.
#
#   source "${LIB_DIR}/catalyst-cloud-read.sh"
#   json="$(catalyst_ticket_json ENG-123)" || { handle the reported failure; }
#
# A machine connected to a cloud account (a `catalyst login` session, or a key in
# CATALYST_CLOUD_TOKEN) reads through the catalyst CLI, or its npx form when the binary is not on
# PATH. When that read fails, the failure is the answer: the cloud's own error stays on stderr with
# the repair step, and the call returns 3. Nothing reroutes a cloud account to direct Linear.
# A machine with no cloud connection is an operator's, off the cloud: it reads through the replica
# helper (freshness gate, then linearis).

__CCR_SELF="${BASH_SOURCE[0]:-${(%):-%x}}"
__CCR_LIB_DIR="$(cd "$(dirname "$__CCR_SELF")" && pwd)"

# catalyst_cloud_connected → 0 when this machine is connected to a cloud account.
catalyst_cloud_connected() {
  [[ -n "${CATALYST_CLOUD_TOKEN:-}" ]] && return 0
  [[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/catalyst-cloud/customer.json" ]] && return 0
  [[ -f "$HOME/.config/catalyst-cloud/customer.json" ]]
}

# catalyst_cli ARGS… → the catalyst CLI, or its npx form when the binary is not on PATH.
catalyst_cli() {
  if command -v catalyst >/dev/null 2>&1; then
    catalyst "$@"
  else
    npx --yes -p @catalyst-cloud/cli catalyst "$@"
  fi
}

# catalyst_ticket_json ID → the ticket as JSON on stdout.
# Returns 3 when a connected machine's cloud read fails (the error is on stderr), 1 when the
# off-cloud read fails.
catalyst_ticket_json() {
  local id="$1"
  if catalyst_cloud_connected; then
    if ! catalyst_cli query issue "$id" --json; then
      echo "catalyst: reading $id through the cloud failed (above). Run \`catalyst ready\` to see why; this machine reads Linear only through the cloud." >&2
      return 3
    fi
    return 0
  fi
  # shellcheck source=lib/linear-read-replica.sh
  source "${__CCR_LIB_DIR}/linear-read-replica.sh" || return 1
  linear_read_ticket "$id"
}
