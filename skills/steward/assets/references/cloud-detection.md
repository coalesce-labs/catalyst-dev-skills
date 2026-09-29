# Cloud detection — before you trust the replica

Steward (and concierge) assume a live Catalyst Cloud replica by default. That assumption is not always true: a single operator working alone, or a host with no mirror running, has neither. So make the assumption a **checked, recoverable** fact, not a silent one. This is the canonical version: one source, carried as a generated copy by each skill that follows it (`steward`, `concierge`), so its commands resolve against whichever skill is running.

## The check — both parts, every time you boot or start a new scope pass

**1. Replica existence + freshness.** Reuse the existing freshness-gate helper — do not write a second one:

```bash
source "${CLAUDE_SKILL_DIR}/scripts/lib/linear-read-replica.sh"
replica_fresh; rf=$?   # rc 0: writer heartbeat lock recent AND sync_meta has a cursor row. rc 1: stale/absent.
```

**2. The `.catalyst` project-config marker.** Presence of a `.catalyst/config.json` walking up from the worktree says this host is configured to run against the Catalyst Cloud stack at all — reuse the existing resolver, do not hand-roll a second walk:

```bash
source "${CLAUDE_SKILL_DIR}/scripts/lib/plugin-dirs.sh"
marker="$(plugin_dirs_repo_config_path)"   # path to .catalyst/config.json, or "" if none found
```

**Cloud mode requires BOTH.** `rf` non-zero OR `marker` empty means "no cloud" for this session — treat the replica as **not** authoritative and take the fallback below.

## The fallback — loud, never silent

When either check fails, say so out loud before reading anything, the same "loud stale/absent" pattern `linear_read_ticket` already uses for a single read. Capture each predicate's own result *before* combining them — negating a compound condition and then reading `$?` inside the `then` block reports the `if`'s own truth value, not which half actually failed, and prints a misleading "everything looked fine" diagnostic:

```bash
if [[ "$rf" -ne 0 || -z "$marker" ]]; then
  echo "⚠️ cloud-detection: NO Catalyst Cloud mirror on this host (replica_fresh_rc=$rf, marker=${marker:-absent}). Falling back to direct linearis reads for list/search — the single-operator path. See assets/references/cloud-detection.md." >&2
  # list/search go straight to `linearis` for this pass; for any SINGLE-ticket read, still call
  # linear_read_ticket <ID> below rather than `linearis issues read` directly — it owns the timeout
  # cap and fallback telemetry this loop doesn't reproduce.
fi
```

For a **single ticket** read, don't hand-roll this at all — `linear_read_ticket <ID>` (same file) already runs the freshness half of this gate and performs the loud fallback per-read; call it directly instead of re-deriving the logic. The two-part check above is for the coarser, session-level question — "should I even attempt scope-wide replica reads this pass" — which `linear_read_ticket` doesn't answer on its own, and it never licenses a bare `linearis issues read` for a single ticket.

## This fallback is the single-operator path, not an equal alternative

The replica exists specifically so bulk Linear reads never hit the Linear API directly: a bare `linearis`/API read draws on the **shared, rate-limited 2500/hr quota** every agent on the host shares, and exhausting it stalls all of them. That is why the `linearis-cli` skill reads from the replica first.

That makes the fallback **correct and safe for a single operator working alone without the cloud stack**, and **actively wrong to recommend to anyone running many agents at once, the workflow this pack is built for.** If you find yourself on the fallback path while other agents are active on this host, that is a writer/mirror gap worth a ticket — not a state to normalize as "either path is fine."
