#!/usr/bin/env bash
# catalyst-cloud-read.sh — read a Linear ticket through the Catalyst cloud.
#
#   source "${LIB_DIR}/catalyst-cloud-read.sh"
#   json="$(catalyst_ticket_json ENG-123)" || { handle the reported failure; }
#
# A machine connected to a cloud account (a `catalyst login` session, or a key in
# CATALYST_CLOUD_TOKEN) reads through the catalyst CLI, or its npx form when the binary is not on
# PATH. When that read fails, the failure is the answer: the cloud's own error stays on stderr with
# the repair step, and the call returns 3. A machine with no cloud connection has no read: the call
# returns 1 and the caller falls back to its own source (describe-pr titles from the branch name).

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
# Returns 3 when the cloud read fails (the error is on stderr), 1 when this machine is not
# connected to a cloud account.
catalyst_ticket_json() {
  local id="$1"
  if ! catalyst_cloud_connected; then
    echo "catalyst: this machine is not connected to a cloud account; run \`catalyst login\`." >&2
    return 1
  fi
  if ! catalyst_cli query issue "$id" --json; then
    echo "catalyst: reading $id through the cloud failed (above). Run \`catalyst ready\` to see why." >&2
    return 3
  fi
}
