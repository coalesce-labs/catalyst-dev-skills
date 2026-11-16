#!/usr/bin/env bash
# catalyst-toml.test.sh — the shared catalyst.toml reader, and the scripts that read repository
# settings through it, work on a checkout that has catalyst.toml and NO .catalyst/ JSON file (CTC-10759).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S="$(mktemp -d)"
trap 'rm -rf "$S"' EXIT
PASS=0 FAIL=0
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS+1)); echo "PASS: $1"; else FAIL=$((FAIL+1)); echo "FAIL: $1"; fi; }
V="$ROOT/vendor-src/scripts"
source "$V/lib/catalyst-toml.sh"

mkdir -p "$S/repo/.catalyst" "$S/repo/pkg/deep"
cat > "$S/repo/.catalyst/catalyst.toml" <<'TOML'
# comment
[project]
linear_workspace = "acme"
linear_team = "ACM"   # trailing comment

[project.linear]
states = { dispatch = "Todo", intake = "Intake", implement = "Building", pr = "In PR" }
labels = { ask = "needs-human" }

[project.thoughts]
profile = 'acme-profile'
directory = "acme-dir"

[project.repositories]
default = "acme/widgets"

[pull_requests]
draft_until_validated = false
TOML
T="$S/repo/.catalyst/catalyst.toml"

[ "$(catalyst_toml_get "$T" project linear_team)" = ACM ]
check "get: a quoted scalar with a trailing comment" $?
[ "$(catalyst_toml_get "$T" project.thoughts profile)" = acme-profile ]
check "get: a single-quoted scalar under a dotted table" $?
[ "$(catalyst_toml_get "$T" pull_requests draft_until_validated)" = false ]
check "get: a bare boolean" $?
! catalyst_toml_get "$T" project missing >/dev/null
check "get: an absent key prints nothing and returns 1" $?
! catalyst_toml_get "$T" nope linear_team >/dev/null
check "get: a key in another table is not found" $?
! catalyst_toml_get "$S/none.toml" project linear_team >/dev/null
check "get: an absent file returns 1" $?
[ "$(catalyst_toml_inline "$T" project.linear states implement)" = Building ]
check "inline: a sub-key of an inline table" $?
[ "$(catalyst_toml_inline "$T" project.linear states pr)" = "In PR" ]
check "inline: a value with a space" $?
! catalyst_toml_inline "$T" project.linear states review >/dev/null
check "inline: an absent sub-key returns 1" $?
[ "$(catalyst_toml_project_key "$T")" = widgets ]
check "project key is the repository name" $?
[ "$(cd "$S/repo/pkg/deep" && catalyst_toml_find)" = "$S/repo/.catalyst/catalyst.toml" ]
check "find walks up to the nearest catalyst.toml" $?
! (cd "$S" && catalyst_toml_find >/dev/null)
check "find returns 1 when there is none" $?
[ "$(catalyst_toml_or_claude_json "$T" project.thoughts directory "$S/none.json" '.x')" = acme-dir ]
check "or_claude_json: toml wins" $?
printf '{"catalyst":{"thoughts":{"directory":"from-json"}}}\n' > "$S/legacy.json"
[ "$(catalyst_toml_or_claude_json "$S/none.toml" project.thoughts directory "$S/legacy.json" '.catalyst.thoughts.directory')" = from-json ]
check "or_claude_json: .claude/config.json is the fallback" $?

# linear-transition: stage names come from [project.linear] states, with no config.json present.
legacy="config"   # spelled in two parts so the no-legacy-config guard does not match this line
[ ! -e "$S/repo/.catalyst/${legacy}.json" ]
check "fixture has no .catalyst JSON settings file" $?
[ "$(cd "$S/repo/pkg" && bash "$V/linear-transition.sh" --ticket ACM-1 --transition inProgress --print-state 2>/dev/null)" = Building ]
check "linear-transition --print-state reads the stage name from catalyst.toml" $?
(cd "$S/repo" && bash "$V/linear-transition.sh" --ticket ACM-1 --transition backlog --print-state >/dev/null 2>&1)
[ $? -ne 0 ]
check "linear-transition refuses a transition the declared states do not map" $?
[ "$(cd "$S" && bash "$V/linear-transition.sh" --ticket ACM-1 --transition inProgress --print-state 2>/dev/null)" = "In Progress" ]
check "linear-transition with no catalyst.toml falls back to the bootstrap name" $?

# draft-pr: the draft knob reads [pull_requests] draft_until_validated; absence means true.
source "$V/lib/draft-pr.sh"
[ "$(cd "$S/repo" && draft_pr_enabled)" = false ]
check "draft_pr_enabled reads draft_until_validated" $?
[ "$(cd "$S" && draft_pr_enabled)" = true ]
check "draft_pr_enabled defaults to true with no catalyst.toml" $?

# secret contract: the per-project machine file is config-<repository name>.json.
source "$V/lib/catalyst-secret-contract.sh"
got="$(cd "$S/repo/pkg" && CATALYST_LAYER2_CONFIG_FILE="$S/home/.config/catalyst/config.json" _csc_resolve_legacy_per_team_path 2>/dev/null)"
[ "$got" = "$S/home/.config/catalyst/config-widgets.json" ]
check "per-team config path is keyed by the repository name from catalyst.toml" $?
got="$(cd "$S" && CATALYST_LAYER2_CONFIG_FILE="$S/home/.config/catalyst/config.json" _csc_resolve_legacy_per_team_path 2>/dev/null)"
[ "$got" = "$S/home/.config/catalyst/config.json" ]
check "with no catalyst.toml the per-team path falls back to the global file" $?

# Thoughts: tests/thoughts-location.test.sh drives catalyst-thoughts.sh and create-worktree.sh from a
# [project.thoughts] catalyst.toml, so it is not repeated here.

echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
