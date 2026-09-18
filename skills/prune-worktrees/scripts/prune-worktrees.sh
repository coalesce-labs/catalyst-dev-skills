#!/usr/bin/env bash
# prune-worktrees.sh — CTC-2550. Classify every tree in a worktree farm; remove only the ones
# provably merged, clean and past the retention window; report every other tree with a named
# reason and leave it in place. See ../references/fail-closed.md for the full invariant.
#
# Usage: prune-worktrees.sh [--dry-run | --apply] [--farm <dir>] [--json] [--help]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib/worktree-remove-guard.sh"

usage() {
  cat <<'EOF'
Usage: prune-worktrees.sh [--dry-run | --apply] [--farm <dir>] [--json] [--help]

  --dry-run   classify and log; remove nothing (default)
  --apply     remove what is provably safe. On a machine with no prior receipt, this STILL
              removes nothing (a dry run), and writes the receipt so the next --apply run applies.
  --farm DIR  override the resolved farm root
  --json      also print every record to stdout
EOF
}

MODE_REQUESTED="dry-run"
FARM_OVERRIDE=""
JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) MODE_REQUESTED="dry-run" ;;
    --apply) MODE_REQUESTED="apply" ;;
    --farm) FARM_OVERRIDE="${2:-}"; shift ;;
    --json) JSON=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "prune-worktrees: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# ── config resolution (D6) ───────────────────────────────────────────────────────────────────
PROFILE="${CATALYST_PROFILE:-workstation}"
if [ -n "$FARM_OVERRIDE" ]; then
  FARM="$FARM_OVERRIDE"
elif [ -n "${CATALYST_WORKTREES_DIR:-}" ]; then
  FARM="$CATALYST_WORKTREES_DIR"
elif [ -n "${CATALYST_WORK_TREES:-}" ]; then
  FARM="$CATALYST_WORK_TREES"
elif [ "$PROFILE" = "workstation" ]; then
  FARM="${HOME}/catalyst/wt"
else
  echo "prune-worktrees: refusing — the directory contract could not resolve every role: CATALYST_WORKTREES_DIR is not set (profile=${PROFILE})" >&2
  exit 3
fi

LOGS_DIR="${CATALYST_LOGS_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/catalyst/logs}"
REPO_ROOT_FALLBACK="${CATALYST_REPO_ROOT:-${CATALYST_HOME:-$HOME/catalyst}/repos}"
RETENTION_DAYS="${CATALYST_WORKTREE_STALE_DAYS:-14}"
ACTOR="${CATALYST_PRUNE_ACTOR:-${USER:-unknown}@$(hostname 2>/dev/null || echo unknown-host)}"
HOST="$(hostname 2>/dev/null || echo unknown-host)"

if [ -n "${CATALYST_WT_CLASSIFIER:-}" ]; then
  if [ ! -x "${CATALYST_WT_CLASSIFIER}" ]; then
    echo "prune-worktrees: refusing — CATALYST_WT_CLASSIFIER (${CATALYST_WT_CLASSIFIER}) is not an executable file" >&2
    exit 3
  fi
fi

LOG_DIR="${LOGS_DIR}/prune-worktrees"
mkdir -p "$LOG_DIR" 2>/dev/null || true
RECEIPT="${LOG_DIR}/first-run-receipt.json"
NOW="${CATALYST_PRUNE_NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
NOW_BASIC="$(printf '%s' "$NOW" | tr -d ':-')"

RUN_MODE="$MODE_REQUESTED"
if [ "$MODE_REQUESTED" = "apply" ] && [ ! -f "$RECEIPT" ]; then
  RUN_MODE="dry-run-first-run"
fi

LOG_FILE="${LOG_DIR}/${NOW_BASIC}-${RUN_MODE}.jsonl"
: > "$LOG_FILE"

emit() {
  # emit <json-line>
  printf '%s\n' "$1" >> "$LOG_FILE"
  [ "$JSON" = 1 ] && printf '%s\n' "$1"
}

json_escape() { # crude but sufficient: backslash and double-quote
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

emit_record() {
  # emit_record <repo> <path> <branch> <verdict> <reason> <head>
  local repo path branch verdict reason head
  repo="$(json_escape "$1")"; path="$(json_escape "$2")"; branch="$3"; verdict="$4"; reason="$(json_escape "$5")"; head="${6:-null}"
  if [ "$branch" = "__NULL__" ]; then branch_json="null"; else branch_json="\"$(json_escape "$branch")\""; fi
  if [ "$head" = "null" ] || [ -z "$head" ]; then head_json="null"; else head_json="\"$(json_escape "$head")\""; fi
  emit "{\"ts\":\"${NOW}\",\"host\":\"$(json_escape "$HOST")\",\"actor\":\"$(json_escape "$ACTOR")\",\"repo\":\"${repo}\",\"path\":\"${path}\",\"branch\":${branch_json},\"verdict\":\"${verdict}\",\"reason\":\"${reason}\",\"head\":${head_json}}"
}

emit_admin() {
  # emit_admin <kind> <repo> <primary>
  emit "{\"kind\":\"$(json_escape "$1")\",\"ts\":\"${NOW}\",\"repo\":\"$(json_escape "$2")\",\"primary\":\"$(json_escape "$3")\"}"
}

# ── enumeration ──────────────────────────────────────────────────────────────────────────────
declare -A PRIMARY_OF_PROJECT=()
declare -A FETCH_FAILED=()
declare -A FETCH_DONE=()
declare -A DEFAULT_OF_PRIMARY=()
declare -A DEFAULT_RESOLVED=()
declare -A PORCELAIN_OF_PRIMARY=()

resolve_primary_for_path() {
  # prints the primary checkout root for a filesystem path that IS a worktree, or nothing
  local p="$1" gcd
  gcd="$(git -C "$p" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  dirname "$gcd"
}

resolve_primary_for_project() {
  local project="$1"
  if [ -n "${PRIMARY_OF_PROJECT[$project]+x}" ]; then
    printf '%s' "${PRIMARY_OF_PROJECT[$project]}"
    return 0
  fi
  local candidate primary=""
  for candidate in "${FARM}/${project}"/*; do
    [ -d "$candidate" ] || continue
    primary="$(resolve_primary_for_path "$candidate" 2>/dev/null)" && [ -n "$primary" ] && break
    primary=""
  done
  if [ -z "$primary" ] && [ -d "${REPO_ROOT_FALLBACK}/${project}" ]; then
    primary="$(resolve_primary_for_path "${REPO_ROOT_FALLBACK}/${project}" 2>/dev/null)" || primary=""
  fi
  PRIMARY_OF_PROJECT["$project"]="$primary"
  printf '%s' "$primary"
}

fetch_once() {
  local primary="$1"
  [ -n "${FETCH_DONE[$primary]+x}" ] && return 0
  FETCH_DONE["$primary"]=1
  if git -C "$primary" fetch --prune --quiet origin >/dev/null 2>&1; then
    FETCH_FAILED["$primary"]=0
  else
    FETCH_FAILED["$primary"]=1
  fi
}

default_for_primary() {
  local primary="$1" ref=""
  if [ -n "${DEFAULT_RESOLVED[$primary]+x}" ]; then
    printf '%s' "${DEFAULT_OF_PRIMARY[$primary]}"
    return 0
  fi
  DEFAULT_RESOLVED["$primary"]=1
  ref="$(git -C "$primary" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)"
  if [ -z "$ref" ]; then
    git -C "$primary" remote set-head origin -a >/dev/null 2>&1
    ref="$(git -C "$primary" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)"
  fi
  if [ -z "$ref" ] && [ -n "${CATALYST_PRUNE_DEFAULT_BRANCH:-}" ]; then
    if git -C "$primary" show-ref --verify --quiet "refs/remotes/origin/${CATALYST_PRUNE_DEFAULT_BRANCH}"; then
      ref="origin/${CATALYST_PRUNE_DEFAULT_BRANCH}"
    fi
  fi
  if [ -z "$ref" ]; then
    local cand
    for cand in main master trunk; do
      if git -C "$primary" show-ref --verify --quiet "refs/remotes/origin/${cand}"; then
        ref="origin/${cand}"
        break
      fi
    done
  fi
  DEFAULT_OF_PRIMARY["$primary"]="$ref"
  printf '%s' "$ref"
}

porcelain_for_primary() {
  local primary="$1"
  if [ -n "${PORCELAIN_OF_PRIMARY[$primary]+x}" ]; then
    printf '%s' "${PORCELAIN_OF_PRIMARY[$primary]}"
    return 0
  fi
  local out
  out="$(git -C "$primary" worktree list --porcelain 2>/dev/null)"
  PORCELAIN_OF_PRIMARY["$primary"]="$out"
  printf '%s' "$out"
}

# porcelain_block_for_path <porcelain-text> <path> — prints the block of lines for one worktree
porcelain_block_for_path() {
  local text="$1" path="$2"
  awk -v want="$path" '
    /^worktree / { cur=substr($0,10); buf=$0; hit=(cur==want); next }
    /^$/ { if (hit) print buf; buf=""; hit=0; next }
    { buf = buf "\n" $0 }
    END { if (hit) print buf }
  ' <<<"$text"$'\n'
}

merge_proof() {
  # merge_proof <primary> <branch> <default-ref>  — echoes the reason, returns 0 for REMOVE-eligible
  local p="$1" b="$2" def="$3" base paths
  base="$(git -C "$p" merge-base "$def" "refs/heads/$b" 2>/dev/null)" || { echo "no-merge-base"; return 1; }
  paths="$(git -C "$p" diff --name-only "$base" "refs/heads/$b" 2>/dev/null)"
  [ -n "$paths" ] || { echo "no-commits-beyond-base"; return 1; }
  if ! git -C "$p" diff --quiet "$def" "refs/heads/$b" -- $paths 2>/dev/null; then
    echo "content-not-in:${def}"
    return 1
  fi
  if git -C "$p" show-ref -q "refs/remotes/origin/$b"; then
    if [ "$(git -C "$p" rev-parse "refs/heads/$b" 2>/dev/null)" != "$(git -C "$p" rev-parse "refs/remotes/origin/$b" 2>/dev/null)" ]; then
      echo "unpushed-commits"
      return 1
    fi
  fi
  echo "merged:content-in-${def}+nothing-unpushed"
  return 0
}

is_within_retention() {
  # is_within_retention <path> <days> — 0 (true) if any file mtime is newer than <days> ago
  local path="$1" days="$2" threshold
  threshold="$(mktemp -u "${TMPDIR:-/tmp}/prune-wt-threshold-XXXXXX")"
  touch -d "-${days} days" "$threshold" 2>/dev/null || { touch "$threshold"; }
  local hit
  hit="$(find "$path" -type f -newer "$threshold" -print -quit 2>/dev/null)"
  rm -f "$threshold"
  [ -n "$hit" ]
}

run_classifier_hook() {
  # run_classifier_hook <record-json> — prints hook stdout (may be empty)
  local record="$1"
  [ -n "${CATALYST_WT_CLASSIFIER:-}" ] || return 0
  printf '%s' "$record" | "${CATALYST_WT_CLASSIFIER}" 2>/dev/null
}

SCANNED=0
REMOVED=0
KEPT=0

# candidates: <project>|<ticket>|<path> lines, deduplicated
CANDIDATES="$(mktemp)"
trap 'rm -f "$CANDIDATES"' EXIT

if [ -d "$FARM" ]; then
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    rel="${d#"$FARM"/}"
    project="${rel%%/*}"
    ticket="${rel#*/}"
    printf '%s|%s|%s\n' "$project" "$ticket" "$d" >> "$CANDIDATES"
  done < <(find "$FARM" -mindepth 2 -maxdepth 2 -type d 2>/dev/null | sort)

  # a directory directly at depth 1 under the farm root that is ITSELF a worktree (has its own
  # .git file/dir) is a candidate too — reported as unsupported-farm-depth:1, never guessed at.
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    if [ -e "$d/.git" ]; then
      printf '%s|%s|%s\n' "$(basename "$d")" "" "$d" >> "$CANDIDATES"
    fi
  done < <(find "$FARM" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)

  # union: for every project directory, also ask its primary's porcelain listing
  while IFS= read -r projdir; do
    [ -n "$projdir" ] || continue
    project="$(basename "$projdir")"
    primary="$(resolve_primary_for_project "$project")"
    PRIMARY_OF_PROJECT["$project"]="$primary"   # resolve_primary_for_project ran in a subshell (command substitution); persist its result here
    [ -n "$primary" ] || continue
    porcelain="$(porcelain_for_primary "$primary")"
    while IFS= read -r wt; do
      [ -n "$wt" ] || continue
      case "$wt" in
        "${FARM}/${project}"/*)
          rel="${wt#"${FARM}/${project}"/}"
          [ "$rel" = "${rel%/*}" ] || continue   # only exactly one more segment (depth 2 total)
          printf '%s|%s|%s\n' "$project" "$rel" "$wt" >> "$CANDIDATES"
          ;;
      esac
    done < <(printf '%s\n' "$porcelain" | awk '/^worktree /{print substr($0,10)}')
  done < <(find "$FARM" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
fi

sort -u -t'|' -k3,3 "$CANDIDATES" -o "$CANDIDATES"

while IFS='|' read -r project ticket path; do
  [ -n "$path" ] || continue
  SCANNED=$((SCANNED + 1))

  # depth check
  rel="${path#"$FARM"/}"
  depth=1
  case "$rel" in */*) depth=$(( $(printf '%s' "$rel" | tr -cd '/' | wc -c) + 1 )) ;; esac
  if [ "$depth" -ne 2 ]; then
    emit_record "$project" "$path" "__NULL__" "KEEP" "unsupported-farm-depth:${depth}" "null"
    KEPT=$((KEPT + 1))
    continue
  fi

  primary="$(resolve_primary_for_project "$project")"
  PRIMARY_OF_PROJECT["$project"]="$primary"   # resolve_primary_for_project ran in a subshell (command substitution); persist its result here
  if [ -z "$primary" ]; then
    emit_record "$project" "$path" "__NULL__" "KEEP" "no-primary-checkout" "null"
    KEPT=$((KEPT + 1))
    continue
  fi

  fetch_once "$primary"
  if [ "${FETCH_FAILED[$primary]}" = "1" ]; then
    emit_record "$project" "$path" "__NULL__" "KEEP" "refs-stale:fetch-failed" "null"
    KEPT=$((KEPT + 1))
    continue
  fi

  default_ref="$(default_for_primary "$primary")"
  if [ -z "$default_ref" ]; then
    emit_record "$project" "$path" "__NULL__" "KEEP" "default-branch-unresolved" "null"
    KEPT=$((KEPT + 1))
    continue
  fi

  porcelain="$(porcelain_for_primary "$primary")"
  block="$(porcelain_block_for_path "$porcelain" "$path")"

  if [ -z "$block" ]; then
    if [ -d "$path" ]; then
      emit_record "$project" "$path" "__NULL__" "KEEP" "not-a-registered-worktree" "null"
    else
      emit_record "$project" "$path" "__NULL__" "KEEP" "prunable" "null"
    fi
    KEPT=$((KEPT + 1))
    continue
  fi

  branch=""
  case "$block" in
    *$'\n'branch\ *)
      branch="$(printf '%s\n' "$block" | awk '/^branch /{print substr($0,8)}')"
      branch="${branch#refs/heads/}"
      ;;
  esac
  head_sha="$(printf '%s\n' "$block" | awk '/^HEAD /{print substr($0,6)}')"

  if printf '%s\n' "$block" | grep -q '^prunable'; then
    emit_record "$project" "$path" "${branch:-__NULL__}" "KEEP" "prunable" "$head_sha"
    KEPT=$((KEPT + 1))
    continue
  fi
  if printf '%s\n' "$block" | grep -q '^locked'; then
    emit_record "$project" "$path" "${branch:-__NULL__}" "KEEP" "locked" "$head_sha"
    KEPT=$((KEPT + 1))
    continue
  fi
  if printf '%s\n' "$block" | grep -q '^detached'; then
    emit_record "$project" "$path" "__NULL__" "KEEP" "detached" "$head_sha"
    KEPT=$((KEPT + 1))
    continue
  fi

  if [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then
    emit_record "$project" "$path" "${branch:-__NULL__}" "KEEP" "dirty" "$head_sha"
    KEPT=$((KEPT + 1))
    continue
  fi

  if is_within_retention "$path" "$RETENTION_DAYS"; then
    emit_record "$project" "$path" "${branch:-__NULL__}" "KEEP" "within-retention-window:${RETENTION_DAYS}d" "$head_sha"
    KEPT=$((KEPT + 1))
    continue
  fi

  reason="$(merge_proof "$primary" "$branch" "$default_ref")"
  rc=$?
  verdict="KEEP"
  [ "$rc" -eq 0 ] && verdict="REMOVE"

  # classifier hook — may only downgrade toward KEEP
  if [ -n "${CATALYST_WT_CLASSIFIER:-}" ]; then
    record_json="{\"repo\":\"$(json_escape "$project")\",\"path\":\"$(json_escape "$path")\",\"branch\":\"$(json_escape "$branch")\",\"builtinVerdict\":\"${verdict}\",\"builtinReason\":\"$(json_escape "$reason")\"}"
    hook_out="$(run_classifier_hook "$record_json")"
    hook_verdict="$(printf '%s' "$hook_out" | jq -r '.verdict // empty' 2>/dev/null)"
    hook_reason="$(printf '%s' "$hook_out" | jq -r '.reason // empty' 2>/dev/null)"
    if [ "$hook_verdict" = "KEEP" ]; then
      verdict="KEEP"
      reason="hook-keep:${hook_reason:-unspecified}"
    elif [ "$hook_verdict" = "REMOVE" ] && [ "$verdict" = "KEEP" ]; then
      emit_record "$project" "$path" "${branch:-__NULL__}" "KEEP" "hook-upgrade-ignored" "$head_sha"
    fi
  fi

  if [ "$verdict" = "REMOVE" ]; then
    if [ "$RUN_MODE" = "apply" ]; then
      guard_reason=""
      assert_worktree_removal_safe "$path" 2>/tmp/prune-wt-guard-err.$$
      grc=$?
      rm -f /tmp/prune-wt-guard-err.$$
      if [ "$grc" -ne 0 ]; then
        case "$grc" in
          3) guard_reason="cwd-containment" ;;
          4) guard_reason="liveness-unprovable" ;;
          5) guard_reason="live-handles" ;;
          *) guard_reason="removal-refused-by-git" ;;
        esac
        emit_record "$project" "$path" "${branch:-__NULL__}" "KEEP" "$guard_reason" "$head_sha"
        KEPT=$((KEPT + 1))
        continue
      fi
      # recheck dirty/locked immediately before acting (F3, done BEFORE the act, not after)
      fresh_porcelain="$(git -C "$primary" worktree list --porcelain 2>/dev/null)"
      fresh_block="$(porcelain_block_for_path "$fresh_porcelain" "$path")"
      if printf '%s\n' "$fresh_block" | grep -q '^locked'; then
        emit_record "$project" "$path" "${branch:-__NULL__}" "KEEP" "locked" "$head_sha"
        KEPT=$((KEPT + 1))
        continue
      fi
      if [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then
        emit_record "$project" "$path" "${branch:-__NULL__}" "KEEP" "dirty" "$head_sha"
        KEPT=$((KEPT + 1))
        continue
      fi
      if git -C "$primary" worktree remove "$path" 2>/tmp/prune-wt-rm-err.$$; then
        rm -f /tmp/prune-wt-rm-err.$$
        emit_record "$project" "$path" "${branch:-__NULL__}" "REMOVE" "$reason" "$head_sha"
        REMOVED=$((REMOVED + 1))
      else
        rm -f /tmp/prune-wt-rm-err.$$
        emit_record "$project" "$path" "${branch:-__NULL__}" "KEEP" "removal-refused-by-git" "$head_sha"
        KEPT=$((KEPT + 1))
      fi
    else
      # dry-run or dry-run-first-run: report the verdict, remove nothing
      emit_record "$project" "$path" "${branch:-__NULL__}" "REMOVE" "$reason" "$head_sha"
      REMOVED=$((REMOVED + 1))
    fi
  else
    emit_record "$project" "$path" "${branch:-__NULL__}" "KEEP" "$reason" "$head_sha"
    KEPT=$((KEPT + 1))
  fi
done < "$CANDIDATES"

# administrative prune for every primary that had a prunable stub, only in a real apply
if [ "$RUN_MODE" = "apply" ]; then
  for project in "${!PRIMARY_OF_PROJECT[@]}"; do
    primary="${PRIMARY_OF_PROJECT[$project]}"
    [ -n "$primary" ] || continue
    if git -C "$primary" worktree list --porcelain 2>/dev/null | grep -q '^prunable'; then
      git -C "$primary" worktree prune >/dev/null 2>&1 || true
      emit_admin "administrative-prune" "$project" "$primary"
    fi
  done
fi

if [ "$RUN_MODE" = "apply" ] && [ "$MODE_REQUESTED" = "apply" ] && [ ! -f "$RECEIPT" ]; then
  : # first-run-on-this-machine: nothing removed above by construction (RUN_MODE stayed dry-run-first-run)
fi

emit "{\"kind\":\"summary\",\"ts\":\"${NOW}\",\"mode\":\"${RUN_MODE}\",\"scanned\":${SCANNED},\"removed\":${REMOVED},\"kept\":${KEPT},\"host\":\"$(json_escape "$HOST")\"}"

if [ "$RUN_MODE" = "dry-run-first-run" ]; then
  echo "prune-worktrees: first run on this machine — nothing removed; run again with --apply to apply" >&2
fi

VERSION="1.0.0"
cat > "$RECEIPT" <<EOF
{"mode":"${RUN_MODE}","ts":"${NOW}","host":"$(json_escape "$HOST")","version":"${VERSION}","scanned":${SCANNED}}
EOF

echo "prune-worktrees: scanned=${SCANNED} removed=${REMOVED} kept=${KEPT} mode=${RUN_MODE} log=${LOG_FILE}"
exit 0
