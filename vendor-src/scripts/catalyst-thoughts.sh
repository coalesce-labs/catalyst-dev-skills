#!/usr/bin/env bash
# catalyst-thoughts.sh — repair and verify the humanlayer thoughts system for a Catalyst project.
#
# Subcommands:
#   init-or-repair   Ensure thoughts/ is a correct humanlayer layout (symlinks + subdirs).
#                    Re-uses `humanlayer thoughts init --force` when humanlayer is configured
#                    and .catalyst/config.json declares catalyst.thoughts.{profile,directory}.
#                    Fails loudly (non-zero) if thoughts/shared exists as a regular directory —
#                    this is the bug state that silently masks a clobbered humanlayer symlink.
#                    Falls back to bare `mkdir -p` with a loud warning only when humanlayer is
#                    absent and no thoughts config exists (genuinely fresh project).
#
#   check            Verify thoughts/ state. Prints findings to stderr and exits non-zero when:
#                      - thoughts/shared or thoughts/global is a regular directory (bug state)
#                      - either is a dangling symlink
#                      - profile in .catalyst/config.json disagrees with humanlayer's mapping
#                      - directory in .catalyst/config.json disagrees with humanlayer's mapping

set -uo pipefail

print_help() {
  cat <<'EOF'
catalyst-thoughts.sh — repair and verify the humanlayer thoughts system for a Catalyst project.

Usage: catalyst-thoughts.sh <command>

Commands:
  init-or-repair   Create or repair thoughts/ for a Catalyst project. Re-uses humanlayer
                   when configured; fails loudly if thoughts/shared exists as a regular
                   directory (the symlink-clobbered bug state).
  check            Verify thoughts/ state; non-zero on any broken state.

Options:
  -h, --help    Show this help and exit
  -V, --version Print version and exit
EOF
}

# CTL-390: --version handling (early, before any arg parsing or stdin reads).
case "${1:-}" in
  --version|-V)
    _CV_SRC="${BASH_SOURCE[0]}"
    while [[ -L "$_CV_SRC" ]]; do
      _CV_D="$(cd -P "$(dirname "$_CV_SRC")" && pwd)" && _CV_SRC="$(readlink "$_CV_SRC")"
      [[ "$_CV_SRC" != /* ]] && _CV_SRC="$_CV_D/$_CV_SRC"
    done
    _CV_DIR="$(cd -P "$(dirname "$_CV_SRC")" && pwd)"
    [[ -f "${_CV_DIR}/lib/catalyst-version.sh" ]] && . "${_CV_DIR}/lib/catalyst-version.sh" \
      && catalyst_print_version "catalyst-thoughts" "${BASH_SOURCE[0]}" && exit 0
    echo "error: catalyst-version helper missing at ${_CV_DIR}/lib/catalyst-version.sh" >&2
    exit 1
    ;;
esac

case "${1:-}" in
  -h|--help|help) print_help; exit 0 ;;
  "")             print_help >&2; exit 1 ;;
esac

CMD="${1:-}"
shift || true

# .catalyst/ first, then .claude/, the same order create-worktree.sh reads them (CTC-3792).
CONFIG_FILE=".catalyst/config.json"
[[ -f "$CONFIG_FILE" || ! -f ".claude/config.json" ]] || CONFIG_FILE=".claude/config.json"
SUBDIRS=(research plans handoffs prs reports)

# CTC-3792: thoughts-location.sh resolves a thoughts repo declared by the paths contract.
# shellcheck source=lib/thoughts-location.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/thoughts-location.sh"

# Sets CAT_PROFILE, CAT_DIR and CAT_DECLARED. A declared thoughts repo wins: CAT_PROFILE becomes the
# HumanLayer profile that points at it (empty for the top-level config) and CAT_DIR defaults to the
# origin's repo name. Without one, both come from .catalyst/config.json, as before.
_read_thoughts_config() {
	CAT_PROFILE="" CAT_DIR="" CAT_DECLARED=""
	if [[ -f "$CONFIG_FILE" ]]; then
		CAT_PROFILE=$(jq -r '.catalyst.thoughts.profile // empty' "$CONFIG_FILE" 2>/dev/null)
		CAT_DIR=$(jq -r '.catalyst.thoughts.directory // empty' "$CONFIG_FILE" 2>/dev/null)
	fi
	local ident org repo
	ident="$(catalyst_repo_identity 2>/dev/null || true)"
	org="${ident%%$'\t'*}"
	repo="${ident#*$'\t'}"
	# Return 2, not 1, when the paths contract refuses (a relative CATALYST_THOUGHTS_REPO, a broken
	# paths.json): "cannot tell" must never read as "nothing declared".
	CAT_DECLARED="$(catalyst_thoughts_repo "$org")" || return 2
	if [[ -n "$CAT_DECLARED" ]]; then
		CAT_DIR="${CAT_DIR:-$repo}"
		# `check` passes _CT_READONLY=1: a diagnostic never writes the HumanLayer config.
		CAT_PROFILE="$(catalyst_thoughts_profile "$CAT_DECLARED" "$org" "$CAT_PROFILE" "${_CT_READONLY:-}")" || return 2
		return 0
	fi
	[[ -f "$CONFIG_FILE" ]]
}

# Prints "<profile>\t<repo>" for the CWD, or empty string if no humanlayer or no mapping.
_humanlayer_mapping() {
	command -v humanlayer &>/dev/null || return 1
	local cwd
	cwd="$(pwd)"
	humanlayer thoughts config --json 2>/dev/null |
		jq -r --arg cwd "$cwd" '.repoMappings[$cwd] // empty | "\(.profile // "")\t\(.repo // "")"'
}

_mkdir_subdirs() {
	local base="$1"
	local d
	for d in "${SUBDIRS[@]}"; do
		mkdir -p "$base/$d"
	done
}

cmd_init_or_repair() {
	# Case A: thoughts/shared is a valid symlink → check for profile/directory drift
	# between .catalyst/config.json and humanlayer's mapping. If found, repair by
	# `humanlayer thoughts uninit --force` followed by re-`init` with the config's
	# profile/directory. Safe because thoughts content lives in the canonical
	# thoughts repo, not in the symlink target. Otherwise, just ensure subdirs.
	local _ct_cfg=0
	_read_thoughts_config || _ct_cfg=$?
	if [[ $_ct_cfg -eq 2 ]]; then
		echo "ERROR: the paths contract refused to name the thoughts repo (see above); nothing was changed" >&2
		return 1
	fi
	if [[ -L "thoughts/shared" && -d "thoughts/shared" ]]; then
		# CTC-3792: with a declared thoughts repo, the whole layout (shared, global, the per-user link
		# and the HumanLayer repo mapping) is rebuilt with the vendored initializer, which is idempotent
		# (ln -sfn over the links; content lives in the repos). A healthy shared link alone does not
		# prove the rest points at the same repo. No CLI needed.
		if [[ $_ct_cfg -eq 0 && -n "${CAT_DECLARED:-}" && -n "${CAT_DIR:-}" ]]; then
			local _ct_init
			_ct_init="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/worktree-thoughts-init.sh"
			local repoint_args=(--directory "$CAT_DIR")
			[[ -n "${CAT_PROFILE:-}" ]] && repoint_args+=(--profile "$CAT_PROFILE")
			if [[ "$(cd thoughts/shared && pwd -P)" != "$(catalyst_thoughts_shared_target "$CAT_DECLARED" "${CAT_PROFILE:-}" "$CAT_DIR")" ]]; then
				echo "  thoughts/shared is not this repository's directory in the declared thoughts repo $CAT_DECLARED — re-pointing."
			fi
			if ! bash "$_ct_init" "${repoint_args[@]}" >/dev/null; then
				echo "ERROR: pointing thoughts at $CAT_DECLARED failed" >&2
				return 1
			fi
			_mkdir_subdirs "thoughts/shared"
			return 0
		fi
		if command -v humanlayer &>/dev/null && _read_thoughts_config && [[ -n "${CAT_DIR:-}" ]]; then
			local mapping hl_profile hl_repo needs_fix=0
			mapping="$(_humanlayer_mapping 2>/dev/null || true)"
			if [[ -n "$mapping" ]]; then
				hl_profile="$(printf '%s' "$mapping" | cut -f1)"
				hl_repo="$(printf '%s' "$mapping" | cut -f2)"
				if [[ -n "${CAT_PROFILE:-}" && -n "$hl_profile" && "$CAT_PROFILE" != "$hl_profile" ]]; then
					needs_fix=1
				fi
				if [[ -n "$hl_repo" && "$CAT_DIR" != "$hl_repo" ]]; then
					needs_fix=1
				fi
			fi
			if [[ $needs_fix -eq 1 ]]; then
				echo "  Drift detected between .catalyst/config.json and humanlayer mapping — repairing."
				echo "  Running: humanlayer thoughts uninit --force"
				if ! humanlayer thoughts uninit --force; then
					echo "ERROR: humanlayer thoughts uninit failed" >&2
					return 1
				fi
				local init_args=(thoughts init --directory "$CAT_DIR")
				[[ -n "${CAT_PROFILE:-}" ]] && init_args+=(--profile "$CAT_PROFILE")
				echo "  Running: humanlayer ${init_args[*]}"
				if ! humanlayer "${init_args[@]}"; then
					echo "ERROR: humanlayer thoughts init failed" >&2
					return 1
				fi
				_mkdir_subdirs "thoughts/shared"
				return 0
			fi
		fi
		_mkdir_subdirs "thoughts/shared"
		return 0
	fi

	# Case B: thoughts/shared exists but is NOT a symlink → the bug state. Refuse to touch it.
	if [[ -e "thoughts/shared" && ! -L "thoughts/shared" ]]; then
		{
			echo "ERROR: thoughts/shared is a regular directory but humanlayer expects a symlink."
			echo "       The humanlayer symlink was clobbered (usually by a bare 'mkdir -p')."
			echo "       Writes to thoughts/shared/ are NOT syncing to any central thoughts repo."
			echo
			echo "Recovery:"
			echo "  mv thoughts/shared thoughts/shared.orphaned-\$(date +%Y%m%d)"
			echo "  rsync -a --ignore-existing thoughts/shared.orphaned-*/  <canonical-thoughts-path>/"
			echo "  bash plugins/dev/scripts/catalyst-thoughts.sh init-or-repair"
		} >&2
		return 2
	fi

	# Case C: thoughts/shared does not exist. Prefer vendored re-init when configured.
	# CTL-845: use worktree-thoughts-init.sh to avoid ERR_INVALID_ARG_TYPE crash in
	# humanlayer v0.17.2-npm. Falls back to humanlayer thoughts init if vendored script
	# is not found (should not occur in a properly installed catalyst workspace).
	# A declared thoughts repo needs no HumanLayer CLI for the vendored layout (CTC-3792).
	if _read_thoughts_config && [[ -n "${CAT_DIR:-}" ]] && { command -v humanlayer &>/dev/null || [[ -n "${CAT_DECLARED:-}" ]]; }; then
		local _ct_dir
		_ct_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
		local VENDOR_INIT="${_ct_dir}/worktree-thoughts-init.sh"
		local init_args=(--directory "$CAT_DIR")
		[[ -n "${CAT_PROFILE:-}" ]] && init_args+=(--profile "$CAT_PROFILE")
		if [ -x "$VENDOR_INIT" ]; then
			echo "  Running: worktree-thoughts-init.sh ${init_args[*]}"
			if bash "$VENDOR_INIT" "${init_args[@]}"; then
				_mkdir_subdirs "thoughts/shared"
				return 0
			fi
		else
			local hl_args=(thoughts init --force --directory "$CAT_DIR")
			[[ -n "${CAT_PROFILE:-}" ]] && hl_args+=(--profile "$CAT_PROFILE")
			echo "  Running: humanlayer ${hl_args[*]}"
			if humanlayer "${hl_args[@]}"; then
				_mkdir_subdirs "thoughts/shared"
				return 0
			fi
		fi
		echo "ERROR: humanlayer thoughts init failed" >&2
		return 1
	fi

	# Case D: no humanlayer and/or no thoughts config. Fall back with a loud warning.
	{
		echo "WARNING: Creating thoughts/shared/ as a regular directory."
		echo "         Writes will NOT sync to a central thoughts repo."
		echo "         To enable syncing, install humanlayer and run:"
		echo "           humanlayer thoughts init --profile <profile> --directory <name>"
	} >&2
	_mkdir_subdirs "thoughts/shared"
	return 0
}

cmd_check() {
	local rc=0

	# 1. Symlink-vs-directory assertions on the two required top-level entries.
	local top
	for top in shared global; do
		if [[ -e "thoughts/$top" && ! -L "thoughts/$top" ]]; then
			{
				echo "ERROR: thoughts/$top is a regular directory but should be a symlink — humanlayer init was bypassed."
				echo "       Recovery: mv thoughts/$top thoughts/$top.orphaned-\$(date +%Y%m%d); bash plugins/dev/scripts/catalyst-thoughts.sh init-or-repair"
			} >&2
			rc=2
		elif [[ -L "thoughts/$top" && ! -e "thoughts/$top" ]]; then
			echo "ERROR: thoughts/$top is a symlink with a missing target." >&2
			rc=2
		fi
	done

	# 2. Profile / directory drift between .catalyst/config.json and humanlayer's mapping.
	local _ck_cfg=0 _CT_READONLY=1
	_read_thoughts_config || _ck_cfg=$?
	if [[ $_ck_cfg -eq 2 ]]; then
		echo "ERROR: the paths contract refused to name the thoughts repo — cannot check where thoughts belong." >&2
		rc=3
	fi
	# CTC-3792: with a declared thoughts repo, a healthy link anywhere but this repository's directory
	# in it is drift, HumanLayer or not.
	if [[ $_ck_cfg -eq 0 && -n "${CAT_DECLARED:-}" && -n "${CAT_DIR:-}" && -L "thoughts/shared" && -d "thoughts/shared" ]]; then
		local want
		want="$(catalyst_thoughts_shared_target "$CAT_DECLARED" "${CAT_PROFILE:-}" "$CAT_DIR")"
		if [[ "$(cd thoughts/shared && pwd -P)" != "$want" ]]; then
			echo "ERROR: thoughts/shared resolves to $(cd thoughts/shared && pwd -P), not $want in the declared thoughts repo. Run: catalyst-thoughts.sh init-or-repair" >&2
			rc=3
		fi
		# The HumanLayer mapping for this worktree must name a profile whose repo is the declared one,
		# or sync follows another repo whatever the link says.
		local hl="${HUMANLAYER_CONFIG:-$HOME/.config/humanlayer/humanlayer.json}" map_profile map_repo map_dir gdir
		map_profile="$(jq -r --arg k "$(pwd -P)" '.thoughts.repoMappings[$k].profile // empty' "$hl" 2>/dev/null)"
		map_dir="$(jq -r --arg k "$(pwd -P)" '.thoughts.repoMappings[$k].repo // empty' "$hl" 2>/dev/null)"
		if [[ -n "$map_dir" && "$map_dir" != "$CAT_DIR" ]]; then
			echo "ERROR: the HumanLayer mapping for $(pwd -P) names project directory '$map_dir', not '$CAT_DIR'. Run: catalyst-thoughts.sh init-or-repair" >&2
			rc=3
		fi
		# thoughts/global must land in the declared repo's global directory too.
		gdir="$(jq -r --arg p "${CAT_PROFILE:-}" '(.thoughts.profiles[$p].globalDir // .thoughts.globalDir) // "global"' "$hl" 2>/dev/null)"
		if [[ -L "thoughts/global" && -d "thoughts/global" && "$(cd thoughts/global && pwd -P)" != "$(cd "$CAT_DECLARED" && pwd -P)/${gdir:-global}" ]]; then
			echo "ERROR: thoughts/global resolves to $(cd thoughts/global && pwd -P), not the declared thoughts repo's ${gdir:-global}. Run: catalyst-thoughts.sh init-or-repair" >&2
			rc=3
		fi
		map_repo="$(jq -r --arg p "$map_profile" '(.thoughts.profiles[$p].thoughtsRepo // .thoughts.thoughtsRepo) // empty' "$hl" 2>/dev/null)"
		if [[ -z "$map_profile" || "$(cd "$map_repo" 2>/dev/null && pwd -P)" != "$(cd "$CAT_DECLARED" && pwd -P)" ]]; then
			echo "ERROR: the HumanLayer mapping for $(pwd -P) (profile '${map_profile:-none}') does not point at the declared thoughts repo $CAT_DECLARED. Run: catalyst-thoughts.sh init-or-repair" >&2
			rc=3
		fi
	fi
	if [[ $_ck_cfg -eq 0 ]]; then
		local mapping hl_profile hl_repo
		mapping="$(_humanlayer_mapping 2>/dev/null || true)"
		if [[ -n "$mapping" ]]; then
			hl_profile="$(printf '%s' "$mapping" | cut -f1)"
			hl_repo="$(printf '%s' "$mapping" | cut -f2)"
			if [[ -n "${CAT_PROFILE:-}" && -n "$hl_profile" && "$CAT_PROFILE" != "$hl_profile" ]]; then
				echo "ERROR: Profile drift — .catalyst/config.json has '${CAT_PROFILE}', humanlayer has '${hl_profile}' for this repo." >&2
				rc=3
			fi
			if [[ -n "${CAT_DIR:-}" && -n "$hl_repo" && "$CAT_DIR" != "$hl_repo" ]]; then
				echo "ERROR: Directory drift — .catalyst/config.json has '${CAT_DIR}', humanlayer has '${hl_repo}' for this repo." >&2
				rc=3
			fi
		fi
	fi

	return $rc
}

case "$CMD" in
	init-or-repair) cmd_init_or_repair "$@" ;;
	check) cmd_check "$@" ;;
	*)
		echo "error: unknown command: $CMD" >&2
		print_help >&2
		exit 1
		;;
esac
