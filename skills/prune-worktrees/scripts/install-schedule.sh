#!/usr/bin/env bash
# install-schedule.sh — CTC-2550. Render, stage or activate the recurring schedule for
# prune-worktrees.sh: systemd --user timer, launchd LaunchAgent, or a delimited crontab block.
# Renders before it writes, and stages (--root) before it ever activates anything.
#
# Usage: install-schedule.sh --render <systemd|launchd|cron>
#        install-schedule.sh --install [--platform <systemd|launchd|cron>] [--root <dir>]
#        install-schedule.sh --uninstall [--platform <systemd|launchd|cron>] [--root <dir>]
#        install-schedule.sh --status [--platform <systemd|launchd|cron>] [--root <dir>]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRUNE_BIN="${SCRIPT_DIR}/prune-worktrees.sh"
LABEL="catalyst-prune-worktrees"
LAUNCHD_LABEL="dev.catalyst.prune-worktrees"

usage() {
  cat <<'EOF'
Usage: install-schedule.sh --render <systemd|launchd|cron>
       install-schedule.sh --install [--platform <systemd|launchd|cron>] [--root <dir>]
       install-schedule.sh --uninstall [--platform <systemd|launchd|cron>] [--root <dir>]
       install-schedule.sh --status [--platform <systemd|launchd|cron>] [--root <dir>]
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
while [ $# -gt 0 ]; do
  case "$1" in
    --render) CMD="render"; PLATFORM="${2:-}"; shift ;;
    --install) CMD="install" ;;
    --uninstall) CMD="uninstall" ;;
    --status) CMD="status" ;;
    --platform) PLATFORM="${2:-}"; shift ;;
    --root) ROOT="${2:-}"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "install-schedule: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[ -n "$CMD" ] || { usage >&2; exit 2; }
[ -n "$PLATFORM" ] || PLATFORM="$(detect_platform)"
case "$PLATFORM" in systemd|launchd|cron) ;; *) echo "install-schedule: unknown platform '$PLATFORM'" >&2; exit 2 ;; esac

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
ExecStart=${PRUNE_BIN} --apply
===FILE:systemd/user/${LABEL}.timer===
[Unit]
Description=catalyst prune-worktrees timer (CTC-2550)

[Timer]
OnCalendar=daily
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
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
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
  cat <<EOF
===FILE:crontab-block===
# BEGIN ${LABEL}
${JITTER} 3 * * * ${PRUNE_BIN} --apply >> \$HOME/.local/state/catalyst/logs/prune-worktrees/cron.log 2>&1
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
