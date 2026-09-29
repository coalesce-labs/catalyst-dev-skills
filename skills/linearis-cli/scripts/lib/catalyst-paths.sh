#!/usr/bin/env bash
# catalyst-paths.sh — resolve a Catalyst machine path the way packages/paths does (CTC-3787).
#
#   source "${LIB_DIR}/catalyst-paths.sh"
#   dir="$(catalyst_path events)" || handle_refusal
#
# Order, for every role: its CATALYST_* variable, then the machine manifest
# (CATALYST_PATHS_FILE, else ${XDG_CONFIG_HOME:-$HOME/.config}/catalyst/paths.json), then the
# standard default. thoughtsRepo and replicaDb have no default: an unset role prints nothing and
# returns 3, so callers keep their own fallback. A set-but-relative variable, an explicitly named
# manifest that is missing, or a manifest that is not a version-1 record refuses with return 2
# and a message on stderr, as packages/paths does. Nothing here creates a directory.
#
# lib/catalyst-paths.mjs is the Node twin; tests/catalyst-paths.test.mjs holds both to one table.
# Needs jq only when a manifest is present.

# _catalyst_path_variable ROLE → the role's environment variable (packages/paths PATH_ROLES).
_catalyst_path_variable() {
  case "$1" in
    repoRoot) echo CATALYST_REPO_ROOT ;;
    worktrees) echo CATALYST_WORKTREES_DIR ;;
    logs) echo CATALYST_LOGS_DIR ;;
    events) echo CATALYST_EVENTS_DIR ;;
    config) echo CATALYST_CONFIG_DIR ;;
    cache) echo CATALYST_CACHE_DIR ;;
    state) echo CATALYST_STATE_DIR ;;
    skills) echo CATALYST_SKILLS_DIR ;;
    thoughtsRepo) echo CATALYST_THOUGHTS_REPO ;;
    replicaDb) echo CATALYST_REPLICA_DB ;;
    *) return 1 ;;
  esac
}

# _catalyst_path_absolute NAME VALUE → prints VALUE, or refuses when it is not absolute.
_catalyst_path_absolute() {
  case "$2" in
    /*) printf '%s' "$2" ;;
    *) echo "catalyst-paths: $1 must be an absolute POSIX path, got '$2'" >&2; return 2 ;;
  esac
}

# _catalyst_path_read NAME → sets _cp_set (x when NAME is set, even empty) and _cp_value. eval, not
# ${!NAME}, because canonical-event.sh is also sourced from zsh (CTL-618). NAME is always one of the
# fixed names in this file.
_catalyst_path_read() {
  eval "_cp_set=\${$1+x}; _cp_value=\${$1-}"
}

# _catalyst_path_base VARIABLE FALLBACK → ${VARIABLE:-FALLBACK}, refusing a set-but-relative value.
_catalyst_path_base() {
  _catalyst_path_read "$1"
  if [[ -n "$_cp_set" ]]; then _catalyst_path_absolute "$1" "$_cp_value"; return; fi
  _catalyst_path_absolute HOME "${HOME:-}" >/dev/null || return 2
  printf '%s' "$2"
}

# catalyst_paths_file → the manifest path to read, or nothing when there is none to read.
catalyst_paths_file() {
  if [[ -n "${CATALYST_PATHS_FILE+x}" ]]; then
    _catalyst_path_absolute CATALYST_PATHS_FILE "$CATALYST_PATHS_FILE"
    return
  fi
  local config
  config="$(_catalyst_path_base XDG_CONFIG_HOME "${HOME:-}/.config")" || return 2
  [[ -e "$config/catalyst/paths.json" || -L "$config/catalyst/paths.json" ]] && printf '%s' "$config/catalyst/paths.json"
  return 0
}

# _catalyst_path_default ROLE → the standard default (packages/paths proposeMachinePaths).
_catalyst_path_default() {
  local home state
  case "$1" in
    repoRoot | worktrees)
      home="$(_catalyst_path_base CATALYST_HOME "${HOME:-}/catalyst")" || return 2
      [[ "$1" == repoRoot ]] && printf '%s/repos' "$home" || printf '%s/wt' "$home" ;;
    logs | events | state)
      state="$(_catalyst_path_base XDG_STATE_HOME "${HOME:-}/.local/state")" || return 2
      case "$1" in logs) printf '%s/catalyst/logs' "$state" ;; events) printf '%s/catalyst/events' "$state" ;; *) printf '%s/catalyst' "$state" ;; esac ;;
    config) home="$(_catalyst_path_base XDG_CONFIG_HOME "${HOME:-}/.config")" || return 2; printf '%s/catalyst' "$home" ;;
    cache) home="$(_catalyst_path_base XDG_CACHE_HOME "${HOME:-}/.cache")" || return 2; printf '%s/catalyst' "$home" ;;
    skills) home="$(_catalyst_path_absolute HOME "${HOME:-}")" || return 2; printf '%s/.agents/skills' "$home" ;;
    *) return 3 ;;
  esac
}

# _catalyst_manifest_role FILE ROLE → the role's path from a machine file (empty when the file
# declares none), or return 1 when the file is not the shape parseMachinePaths accepts: exactly one
# JSON record, version 1, no unknown fields, every required role present, every path an absolute
# string with no NUL (bash would drop it and return another path), and provenance only for roles
# that have a path, with a known source. jq when present; otherwise node, so a producer that
# needs no jq (emit-reap-intent.sh) still honours the manifest.
_catalyst_manifest_role() {
  if command -v jq >/dev/null 2>&1; then
    jq -ers --arg role "$2" '
        (if length == 1 then .[0] else error("not exactly one JSON record") end)
        | ["repoRoot", "worktrees", "logs", "events", "config", "cache", "state", "skills"] as $required
        | ($required + ["thoughtsRepo", "replicaDb"]) as $roles
        | . as $r
        | if type == "object" and .version == 1
            and ((keys - ["version", "paths", "provenance"]) | length) == 0
            and (.paths | type) == "object" and (.provenance | type) == "object"
            and ((.paths | keys) - $roles | length) == 0
            and ([$required[] as $k | $r.paths | has($k)] | all)
            and ([.paths[] | type == "string" and startswith("/") and (contains("\u0000") | not)] | all)
            and ([.provenance | to_entries[] | .key as $k | ($r.paths | has($k))
                  and (.value == "explicit" or .value == "environment" or .value == "imported" or .value == "default")] | all)
          then (.paths[$role] // "") else error("not a version-1 machine record") end' "$1" 2>/dev/null
    return
  fi
  command -v node >/dev/null 2>&1 || { echo "catalyst-paths: reading $1 needs jq or node" >&2; return 1; }
  node -e '
    const fs = require("fs"); const [file, role] = process.argv.slice(1);
    const req = ["repoRoot", "worktrees", "logs", "events", "config", "cache", "state", "skills"];
    const roles = [...req, "thoughtsRepo", "replicaDb"];
    const src = ["explicit", "environment", "imported", "default"];
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    const obj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
    const ok = obj(r) && r.version === 1 && Object.keys(r).every((k) => ["version", "paths", "provenance"].includes(k))
      && obj(r.paths) && obj(r.provenance) && Object.keys(r.paths).every((k) => roles.includes(k))
      && req.every((k) => Object.hasOwn(r.paths, k))
      && Object.values(r.paths).every((v) => typeof v === "string" && v.startsWith("/") && !v.includes("\0"))
      && Object.entries(r.provenance).every(([k, v]) => Object.hasOwn(r.paths, k) && src.includes(v));
    if (!ok) process.exit(1);
    process.stdout.write(r.paths[role] ?? "");
  ' "$1" "$2" 2>/dev/null
}

# catalyst_path ROLE → the resolved absolute path. Returns 2 on a refusal, 3 when the role is unset
# and has no default.
catalyst_path() {
  local role="$1" variable file value
  variable="$(_catalyst_path_variable "$role")" || { echo "catalyst-paths: unknown role $role" >&2; return 2; }
  _catalyst_path_read "$variable"
  if [[ -n "$_cp_set" ]]; then
    _catalyst_path_absolute "$variable" "$_cp_value"
    return
  fi
  file="$(catalyst_paths_file)" || return 2
  if [[ -n "$file" ]]; then
    if [[ ! -r "$file" ]]; then
      echo "catalyst-paths: cannot read machine file $file" >&2
      return 2
    fi
    # Validated as parseMachinePaths does (_catalyst_manifest_role).
    if ! value="$(_catalyst_manifest_role "$file" "$role")"; then
      echo "catalyst-paths: cannot read machine file $file: not a version-1 machine record" >&2
      return 2
    fi
    if [[ -n "$value" ]]; then
      _catalyst_path_absolute "$role" "$value"
      return
    fi
  fi
  _catalyst_path_default "$role"
}

# catalyst_parse_origin URL (CTC-3791) → "<owner>\t<repo>" for a hosted remote: scp-style [user@]host:owner/repo
# or an http(s)/ssh/git URL with exactly <owner>/<repo> as its path. A local path or file:// origin
# names no owner and returns 1, so callers keep their no-owner fallback. sed, not [[ =~ ]], so it
# works when this file is sourced from zsh as well as bash.
catalyst_parse_origin() {
  local tab out
  tab="$(printf '\t')"
  out="$(printf '%s\n' "$1" | sed -nE \
    -e "s#^([^/@:]+@)?[^/@:]+:([^/]+)/([^/]+)\$#\\2${tab}\\3#p" \
    -e "s#^(https?|ssh|git|git\\+ssh)://[^/]+/([^/]+)/([^/]+)\$#\\2${tab}\\3#p" | head -n 1)"
  [[ -n "$out" ]] || return 1
  printf '%s' "${out%.git}"
}

# catalyst_events_dir → where the monthly event log lives. CATALYST_DIR/events is the deprecated
# alias that test preloads set for isolation (CTL-810); it outranks the manifest so a test that sets
# only CATALYST_DIR never reaches a real machine's log.
catalyst_events_dir() {
  if [[ -z "${CATALYST_EVENTS_DIR+x}" && -n "${CATALYST_DIR:-}" ]]; then
    _catalyst_path_absolute CATALYST_DIR "$CATALYST_DIR" >/dev/null || return 2
    printf '%s/events' "$CATALYST_DIR"
    return
  fi
  catalyst_path events
}

# catalyst_legacy_events_dir → the pre-contract location, ~/catalyst/events. Only migration and
# history readers use it; nothing writes there.
catalyst_legacy_events_dir() {
  local home
  home="$(_catalyst_path_absolute HOME "${HOME:-}")" || return 2
  printf '%s/catalyst/events' "$home"
}
