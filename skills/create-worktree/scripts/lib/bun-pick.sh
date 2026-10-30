#!/usr/bin/env bash
# bun-pick.sh — chooses the bun that installs a project whose package.json declares
# "packageManager": "bun@X.Y.Z" when PATH finds an older bun first. create-worktree.sh sources it.
# bash 3.2 safe (macOS /bin/bash): no associative arrays, no mapfile, no ${var,,}.

# catalyst_bun_declared_version <packageManager value> — prints X.Y.Z for bun@X.Y.Z, dropping an
# integrity suffix such as +sha512.…; returns 1 for anything else (another manager, a range, a tag).
catalyst_bun_declared_version() {
	local v="${1:-}"
	case "$v" in bun@*) ;; *) return 1 ;; esac
	v="${v#bun@}"
	v="${v%%+*}"
	[[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
	printf '%s\n' "$v"
}

# catalyst_bun_version <bun binary> — prints the X.Y.Z the binary reports (a -canary or +build
# suffix dropped), or returns 1 when it cannot run or prints something else. `bun --version`
# loads no bunfig.toml preload, so this runs no project code.
catalyst_bun_version() {
	local out
	out="$("$1" --version 2>/dev/null)" || return 1
	out="${out%%[-+]*}"
	[[ "$out" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
	printf '%s\n' "$out"
}

# catalyst_semver_lt <a> <b> — true when X.Y.Z a is lower than b, number by number (1.10.0 > 1.9.0).
catalyst_semver_lt() {
	local a="$1" b="$2" x y
	while [ -n "$a" ] || [ -n "$b" ]; do
		x="${a%%.*}" y="${b%%.*}"
		if [ "$x" = "$a" ]; then a=""; else a="${a#*.}"; fi
		if [ "$y" = "$b" ]; then b=""; else b="${b#*.}"; fi
		[ "${x:-0}" -lt "${y:-0}" ] && return 0
		[ "${x:-0}" -gt "${y:-0}" ] && return 1
	done
	return 1
}

# catalyst_bun_pick <declared X.Y.Z> — sets BUN_PICK_FIRST and BUN_PICK_FIRST_VERSION (the bun PATH
# finds first) and BUN_PICK and BUN_PICK_VERSION (the bun to install with). The first bun is kept
# when it reports the declared version or newer, or when its version cannot be read. When it is
# older, the first other bun on PATH that reports exactly the declared version is picked, else the
# first that reports a newer one. Returns 1 when the first bun is older and no bun on PATH meets
# the declared version; BUN_PICK is then the first bun.
catalyst_bun_pick() {
	local want="$1" cand v newer="" newer_v=""
	# The four BUN_PICK* variables are this library's output interface, read by the sourcing
	# script after this returns; export marks that use for shellcheck (SC2034), which cannot see it.
	export BUN_PICK BUN_PICK_VERSION BUN_PICK_FIRST BUN_PICK_FIRST_VERSION
	BUN_PICK_FIRST="$(command -v bun 2>/dev/null)" || BUN_PICK_FIRST=""
	case "$BUN_PICK_FIRST" in "" | /*) ;; *) BUN_PICK_FIRST="$PWD/$BUN_PICK_FIRST" ;; esac
	BUN_PICK_FIRST_VERSION="$(catalyst_bun_version "$BUN_PICK_FIRST")" || BUN_PICK_FIRST_VERSION=""
	BUN_PICK="$BUN_PICK_FIRST" BUN_PICK_VERSION="$BUN_PICK_FIRST_VERSION"
	[ -n "$BUN_PICK_FIRST" ] && [ -n "$BUN_PICK_FIRST_VERSION" ] || return 0
	catalyst_semver_lt "$BUN_PICK_FIRST_VERSION" "$want" || return 0
	while IFS= read -r cand; do
		[ -n "$cand" ] || continue
		case "$cand" in /*) ;; *) cand="$PWD/$cand" ;; esac
		[ "$cand" = "$BUN_PICK_FIRST" ] && continue
		v="$(catalyst_bun_version "$cand")" || continue
		if [ "$v" = "$want" ]; then
			BUN_PICK="$cand" BUN_PICK_VERSION="$v"
			return 0
		fi
		if [ -z "$newer" ] && catalyst_semver_lt "$want" "$v"; then
			newer="$cand" newer_v="$v"
		fi
	done <<CANDIDATES
$(type -ap bun 2>/dev/null)
CANDIDATES
	if [ -n "$newer" ]; then
		BUN_PICK="$newer" BUN_PICK_VERSION="$newer_v"
		return 0
	fi
	return 1
}

# catalyst_bun_shim_dir <bun binary> — prints a new private directory whose only entries are `bun`
# and `bunx` links to the binary. Put first on PATH for the install, it makes a lifecycle script
# that calls `bun` by name run the same binary as the install itself.
catalyst_bun_shim_dir() {
	local d
	d="$(mktemp -d "${TMPDIR:-/tmp}/catalyst-bun.XXXXXXXX" 2>/dev/null)" || return 1
	if ln -s "$1" "$d/bun" 2>/dev/null && ln -s "$1" "$d/bunx" 2>/dev/null; then
		printf '%s\n' "$d"
		return 0
	fi
	rm -rf "$d"
	return 1
}
