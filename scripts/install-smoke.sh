#!/usr/bin/env bash
# install-smoke.sh — install this repository with the real skills CLI into a scratch HOME and
# check what each harness gets.
#
# Asserts: every skill lands in ~/.agents/skills (the global path Codex and OpenCode read), Claude
# Code gets a link per skill in ~/.claude/skills, and a co-located script runs from inside its
# installed skill directory with no repository next to it.
#
# Run: bash scripts/install-smoke.sh [source]   (source defaults to this repository)
# SKILLS_CLI overrides the pinned CLI (default skills@1.5.26).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${1:-$REPO_ROOT}"
SKILLS_CLI="${SKILLS_CLI:-skills@1.5.26}"

# A default install leaves out the skills marked `metadata: internal: true` (CTC-3202), so the
# expected count is the default-install roster, read by the same parser the scope guard uses.
EXPECTED="$(cd "$REPO_ROOT" && node --input-type=module -e 'const { skillNames } = await import("./scripts/check-name-collisions.mjs"); console.log(skillNames(".").filter((s) => !s.internal).length)')"
SMOKE_HOME="$(mktemp -d)"
# CTC-2558: cwd is deliberately NOT $SMOKE_HOME — a scope regression (this line losing -g) must
# be observable, which it cannot be if cwd and $HOME resolve to the same place.
SMOKE_CWD="$(mktemp -d)"
git init -q "$SMOKE_CWD"
trap 'rm -rf "$SMOKE_HOME" "$SMOKE_CWD"' EXIT

FAIL=0
ok()   { printf '  PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  FAIL: %s\n    %s\n' "$1" "${2:-}"; }

echo "install smoke: $SKILLS_CLI add $SOURCE (HOME=$SMOKE_HOME, cwd=$SMOKE_CWD)"
# The scratch HOME is the whole point: the CLI writes only there. Keep npm's cache outside it so
# a warm cache still helps, and keep the CLI's telemetry off.
NPM_CACHE="${npm_config_cache:-$(npm config get cache 2>/dev/null)}"
(cd "$SMOKE_CWD" && HOME="$SMOKE_HOME" npm_config_cache="$NPM_CACHE" DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 \
  npx -y "$SKILLS_CLI" add "$SOURCE" --skill '*' -a claude-code -a codex -a opencode -g -y) > "$SMOKE_HOME/.install.log" 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then
  tail -40 "$SMOKE_HOME/.install.log"
  fail "skills add exits 0" "exit $rc"
  exit 1
fi
ok "skills add exits 0"

count_dirs() { find "$1" -mindepth 1 -maxdepth 1 \( -type d -o -type l \) 2>/dev/null | wc -l | tr -d ' '; }
count_links() { find "$1" -mindepth 1 -maxdepth 1 -type l 2>/dev/null | wc -l | tr -d ' '; }

AGENTS_DIR="$SMOKE_HOME/.agents/skills"
CLAUDE_DIR="$SMOKE_HOME/.claude/skills"
agents_n="$(count_dirs "$AGENTS_DIR")"
claude_n="$(count_dirs "$CLAUDE_DIR")"
claude_links="$(count_links "$CLAUDE_DIR")"
echo "  skills per harness path:"
for d in "$AGENTS_DIR" "$CLAUDE_DIR" "$SMOKE_HOME/.codex/skills" "$SMOKE_HOME/.config/opencode/skills" "$SMOKE_HOME/.opencode/skills"; do
  [ -e "$d" ] && printf '    %-40s %s entries (%s links)\n' "${d#"$SMOKE_HOME"/}" "$(count_dirs "$d")" "$(count_links "$d")"
done

[ "$EXPECTED" -gt 0 ] || fail "the repository has skills to install" "found $EXPECTED"
if [ "$agents_n" -eq "$EXPECTED" ]; then ok "~/.agents/skills holds all $EXPECTED skills"; else fail "~/.agents/skills holds all $EXPECTED skills" "found $agents_n"; fi
if [ "$claude_n" -eq "$EXPECTED" ] && [ "$claude_links" -eq "$EXPECTED" ]; then
  ok "~/.claude/skills links all $EXPECTED skills"
else
  fail "~/.claude/skills links all $EXPECTED skills" "found $claude_n entries, $claude_links links"
fi

# Every installed skill still carries its SKILL.md through the Claude link.
missing=""
for d in "$CLAUDE_DIR"/*; do
  [ -f "$d/SKILL.md" ] || missing="$missing $(basename "$d")"
done
if [ -z "$missing" ]; then ok "every Claude link resolves to a SKILL.md"; else fail "every Claude link resolves to a SKILL.md" "broken:$missing"; fi

# A co-located script runs from inside its installed directory, reached through the Claude link,
# with cwd outside any checkout and no plugin root.
SKILL_DIR="$CLAUDE_DIR/implement-plan"
out="$(cd "$SMOKE_HOME" && env -u CLAUDE_PLUGIN_ROOT HOME="$SMOKE_HOME" CLAUDE_SKILL_DIR="$SKILL_DIR" \
  bash -c 'source "$CLAUDE_SKILL_DIR/scripts/lib/draft-pr.sh" && declare -F draft_pr_enabled >/dev/null && "$CLAUDE_SKILL_DIR/scripts/add-finding.sh" --help >/dev/null 2>&1 && echo resolved' 2>&1)"
if [ "$out" = "resolved" ]; then
  ok "implement-plan's vendored scripts run from the installed skill directory"
else
  fail "implement-plan's vendored scripts run from the installed skill directory" "${out:0:400}"
fi
if [ -x "$AGENTS_DIR/implement-plan/scripts/add-finding.sh" ]; then
  ok "the install keeps a script's executable bit"
else
  fail "the install keeps a script's executable bit" "$(ls -l "$AGENTS_DIR/implement-plan/scripts/add-finding.sh" 2>&1)"
fi

# CTC-2558: cwd stayed empty — everything landed under $HOME, nothing under the directory the
# install was run from.
cwd_residue="$(find "$SMOKE_CWD" -mindepth 1 -not -path '*/.git*' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$cwd_residue" -eq 0 ]; then
  ok "the working directory the install ran from stayed empty"
else
  fail "the working directory the install ran from stayed empty" "found $cwd_residue path(s) under $SMOKE_CWD"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then echo "install smoke: PASS"; else echo "install smoke: $FAIL failure(s)"; exit 1; fi
