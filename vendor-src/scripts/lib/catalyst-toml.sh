#!/usr/bin/env bash
# catalyst-toml.sh — read a repository setting from `.catalyst/catalyst.toml` (CTC-10759).
#
#   source "${LIB_DIR}/catalyst-toml.sh"
#   toml="$(catalyst_toml_find)"                         # nearest .catalyst/catalyst.toml, or nothing
#   team="$(catalyst_toml_get "$toml" project linear_team)"
#   todo="$(catalyst_toml_inline "$toml" project.linear states dispatch)"
#
# `catalyst.toml` is the only repository settings file. The older JSON settings file is gone:
# nothing here reads it, and every caller works in a checkout that has no such file. A missing
# file, table or key prints nothing and returns 1, so a caller supplies its own default.
#
# The reader understands exactly what the file's canonical form uses: `[table]` headers,
# `key = "string"` / `'string'` / true / false / number, and one-line inline tables
# `key = { a = "x", b = "y" }`. It does not parse arrays, multi-line values or dotted keys. It
# needs only awk, which every Catalyst machine has, so no TOML or JSON tool is a dependency.
#
# Named values (the homes the old keys moved to):
#   old config.json key                         catalyst.toml
#   catalyst.linear.teamKey, project.ticketPrefix   [project] linear_team
#   catalyst.projectKey                              the repository name in [project.repositories] default
#   catalyst.thoughts.{profile,directory}            [project.thoughts] profile, directory
#   catalyst.linear.stateMap                         [project.linear] states = { <stage> = "<state>" }
#   catalyst.orchestration.draftPr.enabled           [pull_requests] draft_until_validated
#
# Idempotent-source guard, safe to source more than once.
[[ -n "${_CATALYST_TOML_SH_LOADED:-}" ]] && return 0
_CATALYST_TOML_SH_LOADED=1

# catalyst_toml_find [START_DIR] — walk up from START_DIR (default $PWD) for
# `.catalyst/catalyst.toml`; print its path, or nothing (returns 1) when there is none.
catalyst_toml_find() {
  local dir="${1:-$PWD}"
  while [[ -n "$dir" && "$dir" != "/" ]]; do
    if [[ -f "${dir}/.catalyst/catalyst.toml" ]]; then
      printf '%s' "${dir}/.catalyst/catalyst.toml"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

# catalyst_toml_get FILE TABLE KEY — the scalar KEY under [TABLE] (TABLE may be dotted, as written
# in the header: project.thoughts). Strips quotes and a trailing comment. Nothing, returns 1, when
# the file, table or key is absent or the value is empty.
catalyst_toml_get() {
  local file="${1:-}" table="${2:-}" key="${3:-}" out
  [[ -n "$file" && -f "$file" && -n "$table" && -n "$key" ]] || return 1
  out="$(awk -v table="$table" -v key="$key" '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    /^[ \t]*\[/ {
      h = $0; sub(/^[ \t]*\[/, "", h); sub(/\][ \t]*(#.*)?$/, "", h)
      inside = (trim(h) == table)
      next
    }
    inside {
      line = $0
      eq = index(line, "=")
      if (eq == 0) next
      k = trim(substr(line, 1, eq - 1))
      if (k != key) next
      v = trim(substr(line, eq + 1))
      if (substr(v, 1, 1) == "\"") { v = substr(v, 2); sub(/".*$/, "", v) }
      else if (substr(v, 1, 1) == "\047") { v = substr(v, 2); sub(/\047.*$/, "", v) }
      else { sub(/[ \t]*#.*$/, "", v) }
      print v
      exit
    }
  ' "$file" 2>/dev/null)" || return 1
  [[ -n "$out" ]] || return 1
  printf '%s' "$out"
}

# catalyst_toml_inline FILE TABLE KEY SUBKEY — SUBKEY from the one-line inline table
# `KEY = { SUBKEY = "value", ... }` under [TABLE]. Same absent rules as catalyst_toml_get.
catalyst_toml_inline() {
  local file="${1:-}" table="${2:-}" key="${3:-}" subkey="${4:-}" out
  [[ -n "$file" && -f "$file" && -n "$table" && -n "$key" && -n "$subkey" ]] || return 1
  out="$(awk -v table="$table" -v key="$key" -v sub_key="$subkey" '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    /^[ \t]*\[/ {
      h = $0; sub(/^[ \t]*\[/, "", h); sub(/\][ \t]*(#.*)?$/, "", h)
      inside = (trim(h) == table)
      next
    }
    inside {
      line = $0
      eq = index(line, "=")
      if (eq == 0) next
      if (trim(substr(line, 1, eq - 1)) != key) next
      v = substr(line, eq + 1)
      lb = index(v, "{"); rb = 0
      for (i = length(v); i > 0; i--) if (substr(v, i, 1) == "}") { rb = i; break }
      if (lb == 0 || rb <= lb) exit
      body = substr(v, lb + 1, rb - lb - 1)
      # Split on commas outside quotes: a state name may hold one ("Review, QA").
      n = 0; cur = ""; q = ""
      for (c = 1; c <= length(body); c++) {
        ch = substr(body, c, 1)
        if (q != "") { if (ch == q) q = ""; cur = cur ch }
        else if (ch == "\"" || ch == "\047") { q = ch; cur = cur ch }
        else if (ch == ",") { parts[++n] = cur; cur = "" }
        else cur = cur ch
      }
      parts[++n] = cur
      for (j = 1; j <= n; j++) {
        p = parts[j]; e = index(p, "=")
        if (e == 0) continue
        if (trim(substr(p, 1, e - 1)) != sub_key) continue
        val = trim(substr(p, e + 1))
        if (substr(val, 1, 1) == "\"") { val = substr(val, 2); sub(/".*$/, "", val) }
        else if (substr(val, 1, 1) == "\047") { val = substr(val, 2); sub(/\047.*$/, "", val) }
        print val
        exit
      }
      exit
    }
  ' "$file" 2>/dev/null)" || return 1
  [[ -n "$out" ]] || return 1
  printf '%s' "$out"
}

# catalyst_toml_project_key FILE — the repository name from [project.repositories] default
# ("owner/name" prints "name"). This is the per-project key the old file called projectKey: it
# names the machine-local `config-<key>.json`. Nothing, returns 1, when the file declares none.
catalyst_toml_project_key() {
  local repo
  repo="$(catalyst_toml_get "${1:-}" project.repositories default)" || return 1
  printf '%s' "${repo##*/}"
}

# catalyst_toml_or_claude_json TOML TABLE KEY JSON JQPATH — KEY under [TABLE] in TOML; when the file
# has no such value, JQPATH is read from JSON, the checkout's `.claude/config.json` (a different, older
# file that some repositories still keep for settings catalyst.toml has no key for). Either file may
# be absent or empty, and an unreadable JSON is skipped. Nothing, returns 1, when neither has it.
catalyst_toml_or_claude_json() {
  local toml="${1:-}" table="${2:-}" key="${3:-}" json="${4:-}" jqpath="${5:-}" out
  if out="$(catalyst_toml_get "$toml" "$table" "$key")"; then printf '%s' "$out"; return 0; fi
  [[ -n "$json" && -f "$json" ]] && command -v jq >/dev/null 2>&1 || return 1
  out="$(jq -r "$jqpath // empty" "$json" 2>/dev/null)" || return 1
  [[ -n "$out" ]] || return 1
  printf '%s' "$out"
}
