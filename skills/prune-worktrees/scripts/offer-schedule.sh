#!/usr/bin/env bash
# offer-schedule.sh — CTC-2550. Propose a cleanup schedule and a retention window the way setup
# proposes location defaults: propose / accept / decline / persist, with no file editing required
# of the operator. See ../references/schedule.md.
#
# Usage: offer-schedule.sh [--accept | --decline | --reset] [--retention-days N]
#                           [--schedule daily|weekly] [--root <dir>] [--json] [--help]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib/plugin-dirs.sh"

usage() {
  cat <<'EOF'
Usage: offer-schedule.sh [--accept | --decline | --reset] [--retention-days N]
                          [--schedule daily|weekly] [--root <dir>] [--json] [--help]

No flag: prints the proposal (schedule + retention window). Writes nothing.
--accept: records acceptance and installs the schedule.
--decline: records the decline. Not asked again until --reset.
--reset: clears the recorded answer.
EOF
}

ACTION="propose"
RETENTION_DAYS="${CATALYST_WORKTREE_STALE_DAYS:-14}"
SCHEDULE="daily"
ROOT=""
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --accept) ACTION="accept" ;;
    --decline) ACTION="decline" ;;
    --reset) ACTION="reset" ;;
    --retention-days) RETENTION_DAYS="${2:-}"; shift ;;
    --schedule) SCHEDULE="${2:-}"; shift ;;
    --root) ROOT="${2:-}"; shift ;;
    --json) JSON=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "offer-schedule: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

CONFIG_PATH="${CATALYST_PRUNE_CONFIG:-$(dirname "$(plugin_dirs_machine_config_path)")/housekeeping.json}"

jitter_for_host() {
  printf '%s' "$(hostname 2>/dev/null || echo unknown-host)" | cksum | awk '{print $1 % 60}'
}

read_config() {
  if [ ! -f "$CONFIG_PATH" ]; then
    printf '{}'
    return 0
  fi
  if ! jq -e . "$CONFIG_PATH" >/dev/null 2>&1; then
    echo "offer-schedule: refusing — ${CONFIG_PATH} is not valid JSON; leaving it untouched" >&2
    return 1
  fi
  cat "$CONFIG_PATH"
}

write_merged() {
  # write_merged <patch-json>
  local patch="$1" existing merged dir tmp
  existing="$(read_config)" || return 1
  dir="$(dirname "$CONFIG_PATH")"
  mkdir -p "$dir"
  merged="$(printf '%s' "$existing" | jq --argjson patch "$patch" '. * $patch')"
  tmp="$(mktemp "${CONFIG_PATH}.XXXXXX")"
  printf '%s\n' "$merged" > "$tmp"
  mv "$tmp" "$CONFIG_PATH"
}

case "$ACTION" in
  reset)
    existing="$(read_config)" || exit 1
    updated="$(printf '%s' "$existing" | jq 'del(.housekeeping)')"
    mkdir -p "$(dirname "$CONFIG_PATH")"
    tmp="$(mktemp "${CONFIG_PATH}.XXXXXX")"
    printf '%s\n' "$updated" > "$tmp"
    mv "$tmp" "$CONFIG_PATH"
    echo "offer-schedule: cleared the recorded answer — the next run will propose again"
    exit 0
    ;;

  accept|decline)
    ts="${CATALYST_PRUNE_NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
    actor="${CATALYST_PRUNE_ACTOR:-${USER:-unknown}@$(hostname 2>/dev/null || echo unknown-host)}"
    patch="$(jq -n --arg answer "$ACTION" --arg schedule "$SCHEDULE" --argjson retentionDays "$RETENTION_DAYS" \
      --arg answeredAt "$ts" --arg actor "$actor" --arg skillVersion "1.0.0" \
      '{housekeeping: {answer: $answer, schedule: $schedule, retentionDays: $retentionDays, answeredAt: $answeredAt, actor: $actor, skillVersion: $skillVersion}}')"
    write_merged "$patch" || exit 1
    if [ "$ACTION" = "accept" ]; then
      installargs=(--install)
      [ -n "$ROOT" ] && installargs+=(--root "$ROOT")
      if ! "${SCRIPT_DIR}/install-schedule.sh" "${installargs[@]}"; then
        echo "offer-schedule: recorded acceptance, but installing the schedule failed" >&2
        exit 1
      fi
    fi
    if [ "$JSON" = 1 ]; then
      printf '%s' "$patch" | jq '.housekeeping'
    else
      echo "offer-schedule: recorded ${ACTION} (schedule=${SCHEDULE}, retentionDays=${RETENTION_DAYS})"
    fi
    exit 0
    ;;

  propose)
    existing="$(read_config)" || exit 1
    recorded="$(printf '%s' "$existing" | jq -c '.housekeeping // empty')"
    if [ -n "$recorded" ]; then
      answer="$(printf '%s' "$recorded" | jq -r '.answer')"
      if [ "$JSON" = 1 ]; then
        printf '%s\n' "$recorded"
      else
        echo "offer-schedule: already ${answer} — not asking again (run with --reset to change your mind)"
      fi
      exit 0
    fi
    jitter="$(jitter_for_host)"
    if [ "$JSON" = 1 ]; then
      jq -n --arg schedule "$SCHEDULE" --argjson retentionDays "$RETENTION_DAYS" --argjson jitterMinute "$jitter" \
        '{proposal: {schedule: $schedule, retentionDays: $retentionDays, jitterMinute: $jitterMinute}}'
    else
      echo "offer-schedule: proposing a ${SCHEDULE} worktree cleanup, keeping anything touched in the last ${RETENTION_DAYS} days"
      echo "  accept:  ${SCRIPT_DIR}/offer-schedule.sh --accept"
      echo "  decline: ${SCRIPT_DIR}/offer-schedule.sh --decline"
    fi
    exit 0
    ;;
esac
