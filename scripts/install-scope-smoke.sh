#!/usr/bin/env bash
# install-scope-smoke.sh — the documented install, run for real, with cwd and $HOME as two
# DIFFERENT directories. install-smoke.sh's scratch cwd and $HOME are the same path, so it
# cannot see scope at all; this is the thing CTC-2558 needs proven end to end.
#
# Asserts: the exact command published in .agents/install-block.md (the canonical block) lands
# every skill under the scratch $HOME and writes nothing into the scratch repository. Then, as a
# negative control at the real-CLI level, repeats the same command with `-g` stripped and asserts
# the repository DOES receive the artifacts, and that check-skill-scope.mjs reports them — a
# checker that always passed would fail this step.
#
# Run: bash scripts/install-scope-smoke.sh [source]   (source defaults to this repository)
# SKILLS_CLI overrides the pinned CLI (default skills@1.5.26).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${1:-$REPO_ROOT}"
SKILLS_CLI="${SKILLS_CLI:-skills@1.5.26}"

EXPECTED="$(find "$REPO_ROOT/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')"

# The canonical block's own add command, with its version pin swapped for $SKILLS_CLI and its
# GitHub slug swapped for $SOURCE — so this exercises what a person actually pastes, not a
# hand-retyped variant.
ADD_LINE="$(sed -n '/```sh/,/```/p' "$REPO_ROOT/.agents/install-block.md" | grep -E '^npx[[:space:]]+skills@\S+[[:space:]]+add[[:space:]]' | head -1)"
if [ -z "$ADD_LINE" ]; then
  echo "FATAL: no 'npx skills@... add ...' line found in .agents/install-block.md" >&2
  exit 1
fi
ARGS="$(printf '%s' "$ADD_LINE" | sed -E 's/^npx[[:space:]]+skills@[^[:space:]]+[[:space:]]+//')"
ARGS="${ARGS/coalesce-labs\/catalyst-dev-skills/$SOURCE}"
case " $ARGS " in
  *" -g "*|*" -g") ;;
  *) echo "FATAL: the canonical add command has no -g — nothing to prove home-scope with: $ADD_LINE" >&2; exit 1 ;;
esac
ARGS_NO_G="$(printf '%s' "$ARGS" | sed -E 's/[[:space:]]+-g\b//')"

FAIL=0
ok()   { printf '  PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  FAIL: %s\n    %s\n' "$1" "${2:-}"; }

NPM_CACHE="${npm_config_cache:-$(npm config get cache 2>/dev/null)}"
CLEANUP=()
cleanup() { for d in "${CLEANUP[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done; }
trap cleanup EXIT

run_install() {
  # run_install <home> <repo> <args...>
  local home="$1" repo="$2"; shift 2
  (cd "$repo" && HOME="$home" npm_config_cache="$NPM_CACHE" DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 \
    npx -y "$SKILLS_CLI" "$@") > "$home/.install.log" 2>&1
}

repo_residue_count() { find "$1" -mindepth 1 -not -path '*/.git*' 2>/dev/null | wc -l | tr -d ' '; }

echo "install scope smoke: $SKILLS_CLI (source=$SOURCE)"

# ── 1. the documented command, -g as published: home gets everything, repo gets nothing ────
HOME_OK="$(mktemp -d)"; REPO_OK="$(mktemp -d)"
CLEANUP+=("$HOME_OK" "$REPO_OK")
git init -q "$REPO_OK"
echo "  running documented command (with -g)…"
# shellcheck disable=SC2086
if run_install "$HOME_OK" "$REPO_OK" $ARGS; then
  ok "documented install (-g) exits 0"
else
  tail -40 "$HOME_OK/.install.log"
  fail "documented install (-g) exits 0"
fi

agents_n="$(find "$HOME_OK/.agents/skills" -mindepth 1 -maxdepth 1 \( -type d -o -type l \) 2>/dev/null | wc -l | tr -d ' ')"
if [ "$agents_n" = "$EXPECTED" ]; then ok "\$HOME/.agents/skills holds all $EXPECTED skills"; else fail "\$HOME/.agents/skills holds all $EXPECTED skills" "found $agents_n"; fi

residue="$(repo_residue_count "$REPO_OK")"
if [ "$residue" -eq 0 ]; then ok "the repository received nothing"; else fail "the repository received nothing" "found $residue path(s): $(find "$REPO_OK" -mindepth 1 -not -path '*/.git*' | tr '\n' ' ')"; fi

if node "$REPO_ROOT/scripts/check-skill-scope.mjs" --home "$HOME_OK" --repo "$REPO_OK" > /tmp/scope-ok.out 2>&1; then
  ok "check-skill-scope.mjs --home --repo exits 0"
else
  cat /tmp/scope-ok.out
  fail "check-skill-scope.mjs --home --repo exits 0"
fi

# ── 2. NEGATIVE CONTROL at the real-CLI level: the same command with -g stripped ────────────
HOME_NEG="$(mktemp -d)"; REPO_NEG="$(mktemp -d)"
CLEANUP+=("$HOME_NEG" "$REPO_NEG")
git init -q "$REPO_NEG"
echo "  running the same command with -g stripped (negative control)…"
# shellcheck disable=SC2086
if run_install "$HOME_NEG" "$REPO_NEG" $ARGS_NO_G; then
  ok "install without -g exits 0"
else
  tail -40 "$HOME_NEG/.install.log"
  fail "install without -g exits 0"
fi

residue_neg="$(repo_residue_count "$REPO_NEG")"
if [ "$residue_neg" -gt 0 ]; then
  ok "without -g, the repository DOES receive artifacts (proves the assertion above is real)"
else
  fail "without -g, the repository DOES receive artifacts" "found none — the -g case above may not be testing anything"
fi

node "$REPO_ROOT/scripts/check-skill-scope.mjs" --home "$HOME_NEG" --repo "$REPO_NEG" > /tmp/scope-neg.out 2>&1
rc=$?
# Grep the VIOLATION text, not the word "repository": the guard always prints a summary line
# ("SCOPE: … 0 repository-scoped; N problem(s)"), so `grep -q "repository"` matched even on a run
# where no repository copy was found at all — a checker that only ever said "nothing was
# installed under $HOME" would have satisfied this control.
if [ "$rc" -ne 0 ] && grep -q "a repository copy is at" /tmp/scope-neg.out; then
  ok "check-skill-scope.mjs reports the repository-scoped install (negative control)"
else
  cat /tmp/scope-neg.out
  fail "check-skill-scope.mjs reports the repository-scoped install (negative control)" "exit $rc"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then echo "install scope smoke: PASS"; else echo "install scope smoke: $FAIL failure(s)"; exit 1; fi
