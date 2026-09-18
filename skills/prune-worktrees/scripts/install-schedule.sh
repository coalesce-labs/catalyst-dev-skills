#!/usr/bin/env bash
# install-schedule.sh — CTC-2550. Render, stage or activate the recurring schedule for
# prune-worktrees.sh: systemd --user timer, launchd LaunchAgent, or a delimited crontab block.
# Renders before it writes, and stages (--root) before it ever activates anything.
#
# The cadence and the retention window are NOT baked in: they come from --schedule /
# --retention-days, or failing that from the answer offer-schedule.sh recorded in
# housekeeping.json. An operator who accepted a weekly cleanup with a 30-day window gets a unit
# that runs weekly and passes 30 through to the run (CTC-2550 M1/C4) — otherwise accepting is
# bookkeeping that changes nothing about what the machine does.
#
# Usage: install-schedule.sh --render <systemd|launchd|cron> [--schedule daily|weekly]
#                            [--retention-days N]
#        install-schedule.sh --install [--platform <systemd|launchd|cron>] [--root <dir>]
#                            [--schedule daily|weekly] [--retention-days N]
#        install-schedule.sh --uninstall [--platform <systemd|launchd|cron>] [--root <dir>]
#        install-schedule.sh --status [--platform <systemd|launchd|cron>] [--root <dir>]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib/plugin-dirs.sh"
PRUNE_BIN="${SCRIPT_DIR}/prune-worktrees.sh"
LABEL="catalyst-prune-worktrees"
LAUNCHD_LABEL="dev.catalyst.prune-worktrees"

usage() {
  cat <<'EOF'
Usage: install-schedule.sh --render <systemd|launchd|cron> [--schedule daily|weekly]
                           [--retention-days N]
       install-schedule.sh --install [--platform <systemd|launchd|cron>] [--root <dir>]
                           [--schedule daily|weekly] [--retention-days N]
       install-schedule.sh --uninstall [--platform <systemd|launchd|cron>] [--root <dir>]
       install-schedule.sh --status [--platform <systemd|launchd|cron>] [--root <dir>]

  --schedule        daily (default) or weekly; defaults to the recorded answer when there is one
  --retention-days  passed to the scheduled run as CATALYST_WORKTREE_STALE_DAYS
EOF
}

jitter_for_host() {
  local h="${1:-$(hostname 2>/dev/null || echo unknown-host)}"
  printf '%s' "$h" | cksum | awk '{print $1 % 60}'
}

detect_platform() {
  case "$(uname -s 2>/dev/null)" in
    Darwin) echo launchd ;;
    Linux) echo systemd ;;
    *) echo cron ;;
  esac
}

CMD=""
PLATFORM=""
ROOT=""
SCHEDULE=""
RETENTION_DAYS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --render) CMD="render"; PLATFORM="${2:-}"; shift ;;
    --install) CMD="install" ;;
    --uninstall) CMD="uninstall" ;;
    --status) CMD="status" ;;
    --platform) PLATFORM="${2:-}"; shift ;;
    --root) ROOT="${2:-}"; shift ;;
    --schedule) SCHEDULE="${2:-}"; shift ;;
    --retention-days) RETENTION_DAYS="${2:-}"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "install-schedule: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[ -n "$CMD" ] || { usage >&2; exit 2; }
[ -n "$PLATFORM" ] || PLATFORM="$(detect_platform)"
case "$PLATFORM" in systemd|launchd|cron) ;; *) echo "install-schedule: unknown platform '$PLATFORM'" >&2; exit 2 ;; esac

# ── the accepted answer, when the flags did not carry one ────────────────────────────────────
CONFIG_PATH="${CATALYST_PRUNE_CONFIG:-$(dirname "$(plugin_dirs_machine_config_path)")/housekeeping.json}"

recorded_value() {
  # recorded_value <jq-filter> — echoes the recorded value, or nothing
  local filter="$1" v
  [ -f "$CONFIG_PATH" ] || return 1
  command -v jq >/dev/null 2>&1 || return 1
  v="$(jq -r "${filter} // empty" "$CONFIG_PATH" 2>/dev/null)" || return 1
  [ -n "$v" ] || return 1
  printf '%s' "$v"
}

[ -n "$SCHEDULE" ] || SCHEDULE="$(recorded_value '.housekeeping.schedule')" || SCHEDULE=""
[ -n "$SCHEDULE" ] || SCHEDULE="daily"
[ -n "$RETENTION_DAYS" ] || RETENTION_DAYS="$(recorded_value '.housekeeping.retentionDays')" || RETENTION_DAYS=""
[ -n "$RETENTION_DAYS" ] || RETENTION_DAYS="${CATALYST_WORKTREE_STALE_DAYS:-14}"

case "$SCHEDULE" in daily|weekly) ;; *) echo "install-schedule: unknown schedule '$SCHEDULE' (expected daily or weekly)" >&2; exit 2 ;; esac
case "$RETENTION_DAYS" in ''|*[!0-9]*) echo "install-schedule: --retention-days must be a non-negative integer (got '${RETENTION_DAYS}')" >&2; exit 2 ;; esac

# cadence, per platform
case "$SCHEDULE" in
  weekly) ONCALENDAR="weekly"; CRON_DOW="0"; LAUNCHD_WEEKDAY_XML="    <key>Weekday</key>
    <integer>0</integer>
" ;;
  *)      ONCALENDAR="daily";  CRON_DOW="*"; LAUNCHD_WEEKDAY_XML="" ;;
esac

log_dir_for_render() {
  # The log directory as the SCHEDULER will see it — $HOME stays literal so a rendered form
  # never carries an absolute /home/<user>/ path, and CATALYST_LOGS_DIR is honoured when set.
  local d="${CATALYST_LOGS_DIR:-\$HOME/.local/state/catalyst/logs}"
  case "$d" in "${HOME}"/*) d="\$HOME/${d#"${HOME}"/}" ;; esac
  printf '%s/prune-worktrees' "$d"
}

JITTER="$(jitter_for_host)"

render_systemd() {
  local delay=$(( (JITTER + 1) * 60 ))
  cat <<EOF
===FILE:systemd/user/${LABEL}.service===
[Unit]
Description=catalyst prune-worktrees — reclaim disk from the worktree farm, fail-closed (CTC-2550)

[Service]
Type=oneshot
Nice=19
IOSchedulingClass=idle
Environment=CATALYST_WORKTREE_STALE_DAYS=${RETENTION_DAYS}
ExecStart=${PRUNE_BIN} --apply
===FILE:systemd/user/${LABEL}.timer===
[Unit]
Description=catalyst prune-worktrees timer (CTC-2550)

[Timer]
OnCalendar=${ONCALENDAR}
Persistent=true
RandomizedDelaySec=${delay}s

[Install]
WantedBy=timers.target
EOF
}

render_launchd() {
  cat <<EOF
===FILE:Library/LaunchAgents/${LAUNCHD_LABEL}.plist===
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PRUNE_BIN}</string>
    <string>--apply</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CATALYST_WORKTREE_STALE_DAYS</key>
    <string>${RETENTION_DAYS}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
${LAUNCHD_WEEKDAY_XML}    <key>Hour</key>
    <integer>3</integer>
    <key>Minute</key>
    <integer>${JITTER}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>Nice</key>
  <integer>19</integer>
  <key>LowPriorityIO</key>
  <true/>
</dict>
</plist>
EOF
}

render_cron() {
  # `mkdir -p` FIRST, in the same line: the shell evaluates a >> redirect before it execs the
  # command, so on a host where the log directory does not exist yet every scheduled run used to
  # die at the redirect and the skill never ran at all (C7). The directory also follows
  # CATALYST_LOGS_DIR rather than hard-coding the XDG default.
  local logdir; logdir="$(log_dir_for_render)"
  cat <<EOF
===FILE:crontab-block===
# BEGIN ${LABEL}
${JITTER} 3 * * ${CRON_DOW} mkdir -p "${logdir}" && CATALYST_WORKTREE_STALE_DAYS=${RETENTION_DAYS} ${PRUNE_BIN} --apply >> "${logdir}/cron.log" 2>&1
# END ${LABEL}
EOF
}

render_for() {
  case "$1" in
    systemd) render_systemd ;;
    launchd) render_launchd ;;
    cron) render_cron ;;
  esac
}

if [ "$CMD" = "render" ]; then
  [ -n "$PLATFORM" ] || { echo "install-schedule: --render needs a platform (systemd|launchd|cron)" >&2; exit 2; }
  render_for "$PLATFORM"
  exit 0
fi

dest_for_rel() {
  # dest_for_rel <root-or-empty> <relpath> — where a rendered file lands
  local root="$1" rel="$2"
  case "$rel" in
    systemd/*) printf '%s/%s\n' "${root:-${XDG_CONFIG_HOME:-$HOME/.config}}" "$rel" ;;
    Library/*) printf '%s/%s\n' "${root:-$HOME}" "$rel" ;;
    crontab-block) printf '%s/%s\n' "${root:-$HOME/.config/catalyst}" "$rel" ;;
  esac
}

write_rendered() {
  # write_rendered <platform> <root> — writes every FILE section; prints the dest paths, one per line
  local platform="$1" root="$2" content rel buf started=0
  content="$(render_for "$platform")"
  rel=""
  buf=""
  flush() {
    [ -n "$rel" ] || return 0
    local dest; dest="$(dest_for_rel "$root" "$rel")"
    mkdir -p "$(dirname "$dest")"
    local tmp; tmp="$(mktemp "${dest}.XXXXXX")"
    printf '%s' "$buf" > "$tmp"
    chmod 0644 "$tmp"
    mv "$tmp" "$dest"
    printf '%s\n' "$dest"
  }
  while IFS= read -r line; do
    case "$line" in
      ===FILE:*===)
        flush
        rel="${line#===FILE:}"; rel="${rel%===}"
        buf=""
        started=1
        ;;
      *)
        if [ "$started" = 1 ]; then buf="${buf}${line}"$'\n'; fi
        ;;
    esac
  done <<EOF2
$content
EOF2
  flush
}

files_for_platform() {
  local platform="$1" root="$2"
  case "$platform" in
    systemd)
      dest_for_rel "$root" "systemd/user/${LABEL}.service"
      dest_for_rel "$root" "systemd/user/${LABEL}.timer"
      ;;
    launchd) dest_for_rel "$root" "Library/LaunchAgents/${LAUNCHD_LABEL}.plist" ;;
    cron) dest_for_rel "$root" "crontab-block" ;;
  esac
}

activate_systemd() {
  command -v systemctl >/dev/null 2>&1 || return 1
  systemctl --user daemon-reload 2>/dev/null &&
    systemctl --user enable --now "${LABEL}.timer" 2>/dev/null &&
    systemctl --user is-enabled "${LABEL}.timer" >/dev/null 2>&1
}

activate_launchd() {
  command -v launchctl >/dev/null 2>&1 || return 1
  local uid; uid="$(id -u)"
  local plist; plist="$(dest_for_rel "" "Library/LaunchAgents/${LAUNCHD_LABEL}.plist")"
  launchctl bootout "gui/${uid}" "${LAUNCHD_LABEL}" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/${uid}" "$plist" 2>/dev/null &&
    launchctl print "gui/${uid}/${LAUNCHD_LABEL}" >/dev/null 2>&1
}

activate_cron() {
  command -v crontab >/dev/null 2>&1 || return 1
  local block
  block="$(render_cron | sed -n '2,$p')"
  { crontab -l 2>/dev/null | awk -v l="$LABEL" '$0=="# BEGIN " l {skip=1} $0=="# END " l {skip=0; next} !skip'; printf '%s\n' "$block"; } | crontab -
  [ "$(crontab -l 2>/dev/null | grep -c "# BEGIN ${LABEL}")" = "1" ]
}

do_install_real() {
  local requested="$1"
  local tries="$requested"
  [ "$requested" != "cron" ] && tries="$requested cron"
  local p
  for p in $tries; do
    case "$p" in
      systemd) command -v systemctl >/dev/null 2>&1 || continue ;;
      launchd) command -v launchctl >/dev/null 2>&1 || continue ;;
      cron) command -v crontab >/dev/null 2>&1 || continue ;;
    esac
    [ "$p" != "$requested" ] && echo "install-schedule: ${requested}'s scheduler is unavailable — falling back to ${p}" >&2
    write_rendered "$p" ""
    case "$p" in
      systemd) activate_systemd ;;
      launchd) activate_launchd ;;
      cron) activate_cron ;;
    esac
    return $?
  done
  echo "install-schedule: refusing — no usable scheduler on PATH for platform '${requested}' (checked: ${tries})" >&2
  return 1
}

case "$CMD" in
  install)
    if [ -n "$ROOT" ]; then
      write_rendered "$PLATFORM" "$ROOT"
      echo "install-schedule: staged ${PLATFORM} files under ${ROOT} (nothing activated)"
      exit 0
    fi
    do_install_real "$PLATFORM"
    exit $?
    ;;
  uninstall)
    if [ -n "$ROOT" ]; then
      while IFS= read -r f; do
        [ -n "$f" ] || continue
        rm -f "$f"
      done < <(files_for_platform "$PLATFORM" "$ROOT")
      echo "install-schedule: removed staged ${PLATFORM} files under ${ROOT}"
      exit 0
    fi
    case "$PLATFORM" in
      systemd)
        command -v systemctl >/dev/null 2>&1 && systemctl --user disable --now "${LABEL}.timer" >/dev/null 2>&1
        ;;
      launchd)
        command -v launchctl >/dev/null 2>&1 && launchctl bootout "gui/$(id -u)" "${LAUNCHD_LABEL}" >/dev/null 2>&1
        ;;
      cron)
        command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | awk -v l="$LABEL" '$0=="# BEGIN " l {skip=1} $0=="# END " l {skip=0; next} !skip' | crontab -
        ;;
    esac
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      rm -f "$f"
    done < <(files_for_platform "$PLATFORM" "")
    echo "install-schedule: uninstalled ${PLATFORM}"
    exit 0
    ;;
  status)
    if [ -n "$ROOT" ]; then
      all_present=1
      while IFS= read -r f; do
        [ -n "$f" ] || continue
        [ -f "$f" ] || all_present=0
      done < <(files_for_platform "$PLATFORM" "$ROOT")
      [ "$all_present" = 1 ] && echo "installed" || echo "not-installed"
      exit 0
    fi
    case "$PLATFORM" in
      systemd)
        if command -v systemctl >/dev/null 2>&1 && systemctl --user is-enabled "${LABEL}.timer" >/dev/null 2>&1; then
          echo "installed"
        else
          echo "not-installed"
        fi
        ;;
      launchd)
        if command -v launchctl >/dev/null 2>&1 && launchctl print "gui/$(id -u)/${LAUNCHD_LABEL}" >/dev/null 2>&1; then
          echo "installed"
        else
          echo "not-installed"
        fi
        ;;
      cron)
        if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -q "# BEGIN ${LABEL}"; then
          echo "installed"
        else
          echo "not-installed"
        fi
        ;;
    esac
    exit 0
    ;;
esac
