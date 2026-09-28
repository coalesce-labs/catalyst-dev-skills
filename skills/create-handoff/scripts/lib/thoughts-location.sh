#!/usr/bin/env bash
# thoughts-location.sh — where a repository's thoughts live, from the paths contract (CTC-3792).
#
#   source "${LIB_DIR}/thoughts-location.sh"
#   repo="$(catalyst_thoughts_repo "$org")" || refuse   # empty: nothing declared, use HumanLayer's config
#   profile="$(catalyst_thoughts_profile "$repo" "$org" "$preferred")" || refuse
#
# The declared thoughts repo is CATALYST_THOUGHTS_REPO, then paths.json's thoughtsRepo, then
# <repoRoot>/<org>/thoughts when that is a git checkout (the standard layout). With none of those,
# callers keep using whatever the HumanLayer config says, as before.
#
# HumanLayer's `thoughts init` has no --repo flag; a profile carries the repo. So a declared repo
# is turned into a named profile that points at it: the caller's preferred profile when it does,
# any other profile that does, or a new `catalyst-<org>` profile added to the config. It is never
# the empty name, because a repo mapping without a profile falls back to .thoughts.defaultProfile,
# which may describe another repo. With no HumanLayer config at all, a minimal one is written whose
# top-level thoughtsRepo is the declared repo, holding that profile as its default.
# HUMANLAYER_CONFIG names the config file (default ~/.config/humanlayer/humanlayer.json), as
# worktree-thoughts-init.sh reads it.

__TL_SELF="${BASH_SOURCE[0]:-${(%):-%x}}"
__TL_LIB_DIR="$(cd "$(dirname "$__TL_SELF")" && pwd)"
# shellcheck source=lib/catalyst-paths.sh
source "${__TL_LIB_DIR}/catalyst-paths.sh"

# catalyst_repo_identity [DIR] → "<owner>\t<repo>" for the git checkout at DIR (default: cwd), from
# the origin URL. Without a hosted origin: an empty owner and the main checkout's folder name,
# which is also right from inside a linked worktree.
catalyst_repo_identity() {
  local dir="${1:-.}" url common
  url="$(git -C "$dir" config --get remote.origin.url 2>/dev/null || true)"
  catalyst_parse_origin "$url" && return 0
  common="$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  printf '\t%s' "$(basename "$(dirname "$common")")"
}

# catalyst_thoughts_repo [ORG] → the declared thoughts repo, or nothing when none is declared.
# Returns 2 when the paths contract refuses (bad variable or manifest) or when the declared path is
# not a git checkout.
catalyst_thoughts_repo() {
  local org="${1:-}" repo_path rc root
  repo_path="$(catalyst_path thoughtsRepo)"
  rc=$?
  if [[ $rc -eq 0 ]]; then
    # A declared repo must already be a checkout: a missing path would be created as a plain
    # directory and reported as a thoughts destination that can never sync.
    if [[ ! -e "$repo_path/.git" ]]; then
      echo "thoughts-location: the declared thoughts repo $repo_path is not a git checkout; clone it there first" >&2
      return 2
    fi
    printf '%s' "$repo_path"
    return 0
  fi
  [[ $rc -eq 3 ]] || return 2
  [[ -n "$org" ]] || return 0
  root="$(catalyst_path repoRoot)" || return 2
  if [[ -e "$root/$org/thoughts/.git" ]]; then printf '%s' "$root/$org/thoughts"; fi
  return 0
}

_tl_physical() { (cd "$1" 2>/dev/null && pwd -P) || printf '%s' "$1"; }

# catalyst_thoughts_profile REPO [ORG] [PREFERRED] [READONLY] → the HumanLayer profile whose
# thoughtsRepo is REPO. Returns 1 when the config cannot be read or written. With READONLY set it
# never writes: it prints the matching profile, or nothing when none exists yet.
catalyst_thoughts_profile() {
  local repo="$1" org="${2:-}" preferred="${3:-}" ro="${4:-}"
  local hl="${HUMANLAYER_CONFIG:-$HOME/.config/humanlayer/humanlayer.json}" want name repo_path tmp
  command -v jq >/dev/null 2>&1 || { echo "thoughts-location: jq is required" >&2; return 1; }
  want="$(_tl_physical "$repo")"
  if [[ ! -f "$hl" ]]; then
    [[ -z "$ro" ]] || return 0
    mkdir -p "$(dirname "$hl")" || return 1
    tmp="$(mktemp "${hl}.XXXXXX")" || return 1
    # A real profile, set as the default, so every repo mapping written against this config names
    # a profile that exists (worktree-thoughts-init.sh falls back to .thoughts.defaultProfile).
    name="catalyst-${org:-default}"
    jq -n --arg r "$repo" --arg u "${USER:-$(id -un)}" --arg p "$name" \
      '{thoughts: {thoughtsRepo: $r, reposDir: "repos", globalDir: "global", user: $u, defaultProfile: $p,
        profiles: {($p): {thoughtsRepo: $r, reposDir: "repos", globalDir: "global"}}, repoMappings: {}}}' >"$tmp" \
      && mv "$tmp" "$hl" || { rm -f "$tmp"; return 1; }
    echo "thoughts-location: wrote $hl with profile $name pointing at $repo" >&2
    printf '%s' "$name"
    return 0
  fi
  if [[ -n "$preferred" ]]; then
    repo_path="$(jq -r --arg p "$preferred" '.thoughts.profiles[$p].thoughtsRepo // empty' "$hl" 2>/dev/null)" || return 1
    if [[ -n "$repo_path" && "$(_tl_physical "$repo_path")" == "$want" ]]; then printf '%s' "$preferred"; return 0; fi
  fi
  # Always a named profile: the repo mapping worktree-thoughts-init.sh writes names it, and an empty
  # name would fall back to .thoughts.defaultProfile, which may describe another repo.
  jq -e '.thoughts | type == "object"' "$hl" >/dev/null 2>&1 || { echo "thoughts-location: cannot read $hl" >&2; return 1; }
  while IFS=$'\t' read -r name repo_path; do
    [[ -n "$name" && -n "$repo_path" ]] || continue
    if [[ "$(_tl_physical "$repo_path")" == "$want" ]]; then printf '%s' "$name"; return 0; fi
  done < <(jq -r '(.thoughts.profiles // {}) | to_entries[] | [.key, (.value.thoughtsRepo // "")] | @tsv' "$hl")
  [[ -z "$ro" ]] || return 0
  name="catalyst-${org:-default}"
  if [[ -n "$(jq -r --arg p "$name" '.thoughts.profiles[$p] // empty' "$hl")" ]]; then
    name="${name}-$(printf '%s' "$want" | cksum | cut -d' ' -f1)"
  fi
  tmp="$(mktemp "${hl}.XXXXXX")" || return 1
  jq --arg p "$name" --arg r "$repo" \
    '.thoughts.profiles[$p] = {thoughtsRepo: $r, reposDir: (.thoughts.reposDir // "repos"), globalDir: (.thoughts.globalDir // "global")}' \
    "$hl" >"$tmp" && mv "$tmp" "$hl" || { rm -f "$tmp"; return 1; }
  echo "thoughts-location: added HumanLayer profile $name for $repo" >&2
  printf '%s' "$name"
}

# catalyst_thoughts_shared_target REPO PROFILE DIR → where this repository's thoughts/shared must
# resolve: <REPO>/<reposDir>/<DIR>/shared, reposDir from PROFILE (else the top-level config, else
# "repos"), the same way worktree-thoughts-init.sh builds the link. Compare it with the link's
# physical path: a link into the right thoughts repo but another project's directory is still wrong.
catalyst_thoughts_shared_target() {
  local repo="$1" profile="${2:-}" dir="$3" hl="${HUMANLAYER_CONFIG:-$HOME/.config/humanlayer/humanlayer.json}" rd=""
  if [[ -f "$hl" ]]; then
    [[ -n "$profile" ]] && rd="$(jq -r --arg p "$profile" '.thoughts.profiles[$p].reposDir // empty' "$hl" 2>/dev/null)"
    [[ -n "$rd" ]] || rd="$(jq -r '.thoughts.reposDir // empty' "$hl" 2>/dev/null)"
  fi
  # Physical all the way down when it exists: a symlinked reposDir or project directory resolves
  # the same way the link's own `pwd -P` does.
  _tl_physical "$(_tl_physical "$repo")/${rd:-repos}/$dir/shared"
}
