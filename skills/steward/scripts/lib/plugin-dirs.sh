#!/usr/bin/env bash
# lib/plugin-dirs.sh — find the repository's `.catalyst/config.json` marker.
#
# The file keeps its historical name so the skills that source it (linearis, concierge, linear,
# steward) and tests/skill-dir-isolation.test.sh keep working. It used to resolve the per-host
# catalyst-dev plugin checkout that phase-agent-dispatch turned into `--plugin-dir` flags for
# worker sessions (CTL-940), and to health-check that checkout (CTL-992). That plugin is retired:
# `coalesce-labs/catalyst-dev-skills` is the only lineage (Ryan, 2026-09-26; CTC-3527 removes the
# plugin from every machine, CTC-3529 retires it here). The checkout resolution, its inputs
# (`CATALYST_PLUGIN_DIRS`, `.catalyst.orchestration.pluginDirs` in the repo or machine config) and
# the checkout health check are gone with it. What remains is the one function every caller used,
# the cloud-detection marker (the concierge and steward `cloud-detection.md` references, and
# skills/linearis/SKILL.md "Reading Linear").
#
# Idempotent-source guard, safe to source more than once.
[[ -n "${_CATALYST_PLUGIN_DIRS_SH_LOADED:-}" ]] && return 0
_CATALYST_PLUGIN_DIRS_SH_LOADED=1

# plugin_dirs_repo_config_path [START_DIR] — walk up from START_DIR (default
# $PWD) looking for .catalyst/config.json; echoes its path or "".
plugin_dirs_repo_config_path() {
  local dir="${1:-$PWD}"
  while [[ "$dir" != "/" && -n "$dir" ]]; do
    if [[ -f "${dir}/.catalyst/config.json" ]]; then
      printf '%s' "${dir}/.catalyst/config.json"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  printf ''
}
